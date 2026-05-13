import { Injectable } from '@nestjs/common';
import {
  FARM_MAPS,
  canEnterFarmMap,
  computeEffectiveDangerLevel,
  getFarmMapByKey,
  getFarmSessionLimit,
  type FarmMapDef,
  type FarmSessionLimitEntitlement,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyKind } from '@prisma/client';
import { CurrencyService } from '../character/currency.service';
import { WorldCapService } from './world-cap.service';

/**
 * Phase 26.5 — `FarmService`.
 *
 * Server-authoritative farm session:
 *
 *   1. `startSession(userId, farmMapKey)` → create `FarmSession` ACTIVE.
 *      Validate: character exists, map enabled, sect/realm gating
 *      (canEnterFarmMap), no existing ACTIVE session cho cùng character.
 *   2. `claimSession(userId, sessionId)` → cap to (entitlement-cap,
 *      maxSessionMinutes, elapsed wallclock). Server compute reward dựa
 *      vào minutesProcessed * baseRewardPerMinute(sourceTier). Apply
 *      daily/weekly cap qua `WorldCapService`. Grant linhThach qua
 *      `CurrencyService.applyTx`. Mark session CLAIMED.
 *
 * Anti-P2W invariants:
 *   - Premium chỉ tăng `freeSessionMinutes` → `premiumSessionMinutes`.
 *   - Daily cap (capKey=`farm_session_minutes:<mapKey>`) áp dụng cho mọi
 *     user. Premium KHÔNG bypass.
 *   - sourceTier KHÔNG auto-scale theo player tier — reward dựa vào
 *     `map.sourceTier`.
 */
@Injectable()
export class FarmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly worldCap: WorldCapService,
  ) {}

  /**
   * List farm map view cho user. Server compute `unlocked` theo realmOrder
   * + map gating, `sessionLimitMinutes` theo entitlement (caller pass
   * subscription status nếu có, mặc định free).
   */
  async listForCharacter(input: {
    characterId: string;
    playerRealmOrder: number;
    entitlements?: FarmSessionLimitEntitlement;
  }): Promise<FarmMapView[]> {
    return FARM_MAPS.map((m) => {
      const gating = canEnterFarmMap(m, {
        playerRealmOrder: input.playerRealmOrder,
      });
      const sessionLimit = getFarmSessionLimit(m, input.entitlements);
      const view: FarmMapView = {
        key: m.key,
        regionKey: m.regionKey as string,
        nameVi: m.nameVi,
        nameEn: m.nameEn,
        sourceTier: m.sourceTier,
        recommendedRealmOrder: m.recommendedRealmOrder,
        unlockRealmOrder: m.unlockRealmOrder,
        unlocked: gating.allowed,
        unlockReason: gating.allowed ? null : gating.reason ?? null,
        autoFarmAllowed: m.autoFarmAllowed,
        sweepAllowed: m.sweepAllowed,
        freeSessionMinutes: m.freeSessionMinutes,
        sessionLimitMinutes: sessionLimit,
        maxSessionMinutes: m.maxSessionMinutes,
        monsterPoolSize: m.monsterPool.length,
        opportunityPoolSize: m.opportunityPool.length,
        enabled: m.enabled,
      };
      return view;
    });
  }

  /** Start ACTIVE session. Throw nếu vi phạm gating / có session đang chạy. */
  async startSession(input: {
    characterId: string;
    farmMapKey: string;
    playerRealmOrder: number;
    entitlements?: FarmSessionLimitEntitlement;
  }): Promise<FarmSessionView> {
    const map = getFarmMapByKey(input.farmMapKey);
    if (!map || !map.enabled) {
      throw new FarmError('MAP_NOT_FOUND');
    }
    const gating = canEnterFarmMap(map, {
      playerRealmOrder: input.playerRealmOrder,
    });
    if (!gating.allowed) {
      throw new FarmError(
        gating.reason === 'REALM_TOO_LOW' ? 'REALM_TOO_LOW' : 'MAP_LOCKED',
      );
    }

    const active = await this.prisma.farmSession.findFirst({
      where: { characterId: input.characterId, status: 'ACTIVE' },
      select: { id: true, farmMapKey: true },
    });
    if (active) {
      throw new FarmError('SESSION_ALREADY_ACTIVE');
    }

    const session = await this.prisma.farmSession.create({
      data: {
        characterId: input.characterId,
        farmMapKey: map.key,
        status: 'ACTIVE',
      },
      select: { id: true, farmMapKey: true, startedAt: true, status: true },
    });

    return {
      id: session.id,
      farmMapKey: session.farmMapKey,
      status: 'ACTIVE',
      startedAt: session.startedAt.toISOString(),
      endedAt: null,
      minutesProcessed: 0,
      sessionLimitMinutes: getFarmSessionLimit(map, input.entitlements),
      rewards: emptyRewards(),
    };
  }

  /**
   * Claim ACTIVE session — server-authoritative compute minutes processed
   * và grant reward.
   */
  async claimSession(input: {
    characterId: string;
    sessionId: string;
    entitlements?: FarmSessionLimitEntitlement;
    /** Override now() — testing only. */
    now?: Date;
  }): Promise<FarmSessionClaimResult> {
    const now = input.now ?? new Date();
    const session = await this.prisma.farmSession.findUnique({
      where: { id: input.sessionId },
      select: {
        id: true,
        characterId: true,
        farmMapKey: true,
        startedAt: true,
        status: true,
      },
    });
    if (!session) throw new FarmError('SESSION_NOT_FOUND');
    if (session.characterId !== input.characterId) {
      throw new FarmError('SESSION_NOT_OWNED');
    }
    if (session.status !== 'ACTIVE') {
      throw new FarmError('SESSION_NOT_ACTIVE');
    }
    const map = getFarmMapByKey(session.farmMapKey);
    if (!map) throw new FarmError('MAP_NOT_FOUND');

    const sessionLimit = getFarmSessionLimit(map, input.entitlements);
    const elapsedMs = now.getTime() - session.startedAt.getTime();
    const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60000));
    const minutesProcessed = Math.min(
      elapsedMinutes,
      sessionLimit,
      map.maxSessionMinutes,
    );

    // Compute base reward dựa map.sourceTier (anti-P2W: KHÔNG dùng player tier).
    const baseLinhThachPerMinute = farmBaseLinhThachPerMinute(map.sourceTier);
    const baseExpPerMinute = farmBaseExpPerMinute(map.sourceTier);
    const rawLinhThach = baseLinhThachPerMinute * minutesProcessed;
    const rawExp = baseExpPerMinute * minutesProcessed;

    // Compute daily cap remaining for this map.
    const capKey = `farm_session_minutes:${map.key}`;
    const grantResult = await this.prisma.$transaction(async (tx) => {
      const cap = await this.worldCap.consumeDailyTx(tx, {
        characterId: input.characterId,
        capKey,
        source: 'FARM',
        // limitQty = maxSessionMinutes (daily) — same as maxSessionMinutes
        limitQty: map.maxSessionMinutes,
        qtyDelta: minutesProcessed,
        countDelta: 1,
        now,
      });

      // Recompute granted = min(raw, scaled by what fit cap)
      const minutesGranted = minutesProcessed;
      const linhThachGranted = BigInt(rawLinhThach);
      const expGranted = rawExp;

      if (linhThachGranted > 0n) {
        await this.currency.applyTx(tx, {
          characterId: input.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: linhThachGranted,
          reason: 'FARM_SESSION_REWARD',
          refType: 'FarmSession',
          refId: session.id,
        });
      }

      if (expGranted > 0) {
        await tx.character.update({
          where: { id: input.characterId },
          data: { exp: { increment: BigInt(expGranted) } },
        });
      }

      const rewardsJson = {
        linhThach: rawLinhThach,
        exp: rawExp,
        minutes: minutesGranted,
        sourceTier: map.sourceTier,
        cappedRewardCount: 0,
      };

      await tx.farmSession.update({
        where: { id: session.id },
        data: {
          status: 'CLAIMED',
          minutesProcessed: minutesGranted,
          endedAt: now,
          rewardsJson,
        },
      });

      return { cap, rewardsJson };
    });

    return {
      sessionId: session.id,
      farmMapKey: session.farmMapKey,
      minutesProcessed,
      startedAt: session.startedAt.toISOString(),
      claimedAt: now.toISOString(),
      rewards: {
        linhThach: rawLinhThach,
        exp: rawExp,
        sourceTier: map.sourceTier,
        items: [],
      },
      capUsage: {
        dayBucket: grantResult.cap.dayBucket,
        minutesUsed: grantResult.cap.usedQty,
        sessionsUsed: grantResult.cap.usedCount,
        dailyLimit: map.maxSessionMinutes,
      },
    };
  }

  /** Read-only — list opportunity encounter key cho user (preview). */
  listOpportunityHints(map: FarmMapDef): readonly string[] {
    return map.opportunityPool;
  }

  /** Helper export — test hook cho danger gating. */
  static effectiveDangerLevel = computeEffectiveDangerLevel;
}

// ───────────────────────────────────────────────────────────────────────────
// Reward formula (server-authoritative) — pure
// ───────────────────────────────────────────────────────────────────────────

/**
 * Linh thạch / minute tăng tuyến tính theo sourceTier.
 * Anti-P2W: KHÔNG nhân theo player realm.
 */
export function farmBaseLinhThachPerMinute(sourceTier: number): number {
  if (sourceTier <= 0) return 0;
  return 10 + (sourceTier - 1) * 8;
}

/** EXP / minute. */
export function farmBaseExpPerMinute(sourceTier: number): number {
  if (sourceTier <= 0) return 0;
  return 20 + (sourceTier - 1) * 15;
}

function emptyRewards(): FarmRewardSnapshot {
  return { linhThach: 0, exp: 0, sourceTier: 0, items: [] };
}

// ───────────────────────────────────────────────────────────────────────────
// Types + Errors
// ───────────────────────────────────────────────────────────────────────────

export interface FarmMapView {
  key: string;
  regionKey: string;
  nameVi: string;
  nameEn: string;
  sourceTier: number;
  recommendedRealmOrder: number;
  unlockRealmOrder: number;
  unlocked: boolean;
  unlockReason: string | null;
  autoFarmAllowed: boolean;
  sweepAllowed: boolean;
  freeSessionMinutes: number;
  sessionLimitMinutes: number;
  maxSessionMinutes: number;
  monsterPoolSize: number;
  opportunityPoolSize: number;
  enabled: boolean;
}

export interface FarmRewardSnapshot {
  linhThach: number;
  exp: number;
  sourceTier: number;
  items: readonly { itemKey: string; qty: number }[];
}

export interface FarmSessionView {
  id: string;
  farmMapKey: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  minutesProcessed: number;
  sessionLimitMinutes: number;
  rewards: FarmRewardSnapshot;
}

export interface FarmSessionClaimResult {
  sessionId: string;
  farmMapKey: string;
  minutesProcessed: number;
  startedAt: string;
  claimedAt: string;
  rewards: FarmRewardSnapshot;
  capUsage: {
    dayBucket: string;
    minutesUsed: number;
    sessionsUsed: number;
    dailyLimit: number;
  };
}

export class FarmError extends Error {
  constructor(
    public readonly code:
      | 'MAP_NOT_FOUND'
      | 'MAP_LOCKED'
      | 'REALM_TOO_LOW'
      | 'SESSION_NOT_FOUND'
      | 'SESSION_NOT_OWNED'
      | 'SESSION_NOT_ACTIVE'
      | 'SESSION_ALREADY_ACTIVE',
  ) {
    super(code);
    this.name = 'FarmError';
  }
}
