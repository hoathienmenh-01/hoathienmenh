import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  BODY_CULTIVATION_INJURY_GAIN_MULT,
  BODY_CULTIVATION_STAMINA_PER_TICK,
  type BodyCultivateTickPayload,
  bodyExpCostForStage,
  bodyRateForRealm,
  computeMethodBodyRateBonus,
  getBodyRealmByKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { CultivationMethodV2Service } from '../character/cultivation-method-v2.service';
import { BODY_CULTIVATION_QUEUE } from './body-cultivation.queue';

@Processor(BODY_CULTIVATION_QUEUE)
export class BodyCultivationProcessor extends WorkerHost {
  private readonly logger = new Logger(BodyCultivationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly rewardCap: RewardCapService,
    // Phase 26.3 — body method V2 EXP bonus wire. Optional cho backward-
    // compat test bootstrap. Snapshot rỗng → mul 1.0 identity.
    @Optional()
    private readonly cultivationMethodV2?: CultivationMethodV2Service,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'body-tick') return;
    const rows = await this.prisma.character.findMany({
      where: { bodyCultivating: true },
      select: {
        id: true,
        userId: true,
        realmKey: true,
        bodyRealmKey: true,
        bodyStage: true,
        bodyExp: true,
        bodyInjuryUntil: true,
        stamina: true,
      },
    });
    for (const c of rows) {
      try {
        if (c.stamina < BODY_CULTIVATION_STAMINA_PER_TICK) continue;
        const injuryMul =
          c.bodyInjuryUntil && c.bodyInjuryUntil.getTime() > Date.now()
            ? BODY_CULTIVATION_INJURY_GAIN_MULT
            : 1;
        // Phase 26.3 — body method V2 aggregated equipped bonus. Mul cap
        // ở `aggregateEquippedMethods` via `METHOD_BONUS_CAPS.bodyExpPercent`.
        let methodV2Mul = 1.0;
        if (this.cultivationMethodV2) {
          try {
            const snapshot = await this.cultivationMethodV2.getEquippedSnapshot(c.id);
            methodV2Mul = computeMethodBodyRateBonus(snapshot);
          } catch {
            methodV2Mul = 1.0;
          }
        }
        const requestedGain = BigInt(
          Math.max(
            1,
            Math.round(bodyRateForRealm(c.bodyRealmKey) * injuryMul * methodV2Mul),
          ),
        );
        const outcome = await this.prisma.$transaction(async (tx) => {
          const cap = await this.rewardCap.applyCapTx(tx, {
            characterId: c.id,
            source: 'BODY_CULTIVATION',
            requestedExp: requestedGain,
            requestedLinhThach: 0n,
            realmKey: c.bodyRealmKey,
            refType: 'BodyCultivationTick',
            meta: { jobName: job.name },
          });
          if (cap.grantedExp === 0n) return { kind: 'capped' as const };
          let bodyExp = c.bodyExp + cap.grantedExp;
          let bodyStage = c.bodyStage;
          let stagedUp = false;
          const bodyRealm = getBodyRealmByKey(c.bodyRealmKey);
          let cost = bodyExpCostForStage(c.bodyRealmKey, bodyStage);
          while (
            bodyRealm &&
            cost !== null &&
            bodyExp >= cost &&
            bodyStage < bodyRealm.stages
          ) {
            bodyExp -= cost;
            bodyStage += 1;
            stagedUp = true;
            cost = bodyExpCostForStage(c.bodyRealmKey, bodyStage);
          }
          const upd = await tx.character.updateMany({
            where: {
              id: c.id,
              bodyExp: c.bodyExp,
              bodyStage: c.bodyStage,
              bodyCultivating: true,
              stamina: { gte: BODY_CULTIVATION_STAMINA_PER_TICK },
            },
            data: {
              bodyExp,
              bodyStage,
              stamina: { decrement: BODY_CULTIVATION_STAMINA_PER_TICK },
            },
          });
          if (upd.count === 0) throw new Error('CAS_MISS');
          return {
            kind: 'granted' as const,
            grantedGain: cap.grantedExp,
            bodyExp,
            bodyStage,
            stagedUp,
          };
        }).catch((err: unknown) => {
          if (err instanceof Error && err.message === 'CAS_MISS') {
            return { kind: 'cas_miss' as const };
          }
          throw err;
        });
        if (outcome.kind !== 'granted') continue;
        const expNext = bodyExpCostForStage(c.bodyRealmKey, outcome.bodyStage);
        const payload: BodyCultivateTickPayload = {
          characterId: c.id,
          expGained: outcome.grantedGain.toString(),
          bodyExp: outcome.bodyExp.toString(),
          bodyExpNext: (expNext ?? 0n).toString(),
          bodyRealmKey: c.bodyRealmKey,
          bodyStage: outcome.bodyStage,
          stagedUp: outcome.stagedUp,
        };
        this.realtime.emitToUser(c.userId, 'body-cultivate:tick', payload);
      } catch (e) {
        this.logger.error(
          `body tick failed for char=${c.id}: ${(e as Error).message}`,
        );
      }
    }
  }
}
