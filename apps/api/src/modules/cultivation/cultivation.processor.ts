import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  CULTIVATION_TICK_BASE_EXP,
  CULTIVATION_TICK_MS,
  SPIRITUAL_ROOT_GRADES,
  STAMINA_REGEN_PER_TICK,
  cultivationRateForRealm,
  expCostForStage,
  getSpiritualRootGradeDef,
  type CultivateTickPayload,
  type SpiritualRootGrade,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MissionService } from '../mission/mission.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { AchievementService } from '../character/achievement.service';
import { BuffService } from '../character/buff.service';
import {
  computeMethodElementAffinityForCharacter,
  methodExpMultiplierFor,
} from '../character/cultivation-method.service';
import { CultivationMethodV2Service } from '../character/cultivation-method-v2.service';
import { computeMethodCultivationRateBonus } from '@xuantoi/shared';
import { TalentService } from '../character/talent.service';
import { LiveOpsEventSchedulerService } from '../liveops-event-scheduler/liveops-event-scheduler.service';
import { CULTIVATION_QUEUE } from './cultivation.queue';

/**
 * Phase 11.3.C narrowing helper — kiểm tra Prisma trả về `string | null` có
 * khớp catalog `SPIRITUAL_ROOT_GRADES` không. Legacy character pre-Phase
 * 11.3 sẽ có `spiritualRootGrade=null` → return false → multiplier 1.0.
 */
function isValidSpiritualRootGrade(
  grade: string | null,
): grade is SpiritualRootGrade {
  return grade !== null && (SPIRITUAL_ROOT_GRADES as readonly string[]).includes(grade);
}

@Processor(CULTIVATION_QUEUE)
export class CultivationProcessor extends WorkerHost {
  private readonly logger = new Logger(CultivationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly missions: MissionService,
    private readonly rewardCap: RewardCapService,
    @Optional() private readonly achievements?: AchievementService,
    @Optional() private readonly talents?: TalentService,
    @Optional() private readonly buffs?: BuffService,
    @Optional()
    private readonly liveOpsEvents?: LiveOpsEventSchedulerService,
    // Phase 26.3 — Cultivation Method V2 equipped bonus wire. Optional cho
    // backward-compat test bootstrap. Legacy character chưa unlock V2 →
    // snapshot rỗng → mul = 1.0 identity.
    @Optional()
    private readonly cultivationMethodV2?: CultivationMethodV2Service,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'tick') return;

    // Hồi stamina cho TẤT CẢ character (kể cả không tu luyện): +N mỗi tick, cap = staminaMax.
    await this.prisma.$executeRawUnsafe(
      `UPDATE "Character" SET stamina = LEAST("staminaMax", stamina + $1) WHERE stamina < "staminaMax"`,
      STAMINA_REGEN_PER_TICK,
    );

    const cultivating = await this.prisma.character.findMany({
      where: { cultivating: true },
      select: {
        id: true,
        userId: true,
        realmKey: true,
        realmStage: true,
        exp: true,
        spirit: true,
        spiritualRootGrade: true,
        // Phase 11.1.E — primary/secondary cần cho method element affinity
        // bonus compose. Legacy character (null/[]) → bonus 0 (identity).
        primaryElement: true,
        secondaryElements: true,
        equippedCultivationMethodKey: true,
      },
    });
    if (cultivating.length === 0) return;

    // Phase 15.2 — LiveOps Event Scheduler `CULTIVATION_EXP_BOOST` fetch
    // ONCE per tick (snapshot multiplier shared cho mọi character cultivating
    // để tránh per-character query). Fail-soft: lỗi → multiplier 1.0,
    // tick vẫn chạy. Multiplier đã clamp ≤ 2.0 (shared `clampLiveOpsMultiplier`).
    let liveOpsExpMul = 1.0;
    try {
      if (this.liveOpsEvents) {
        liveOpsExpMul = await this.liveOpsEvents.getActiveMultiplier(
          'CULTIVATION_EXP_BOOST',
        );
      }
    } catch {
      liveOpsExpMul = 1.0;
    }

    for (const c of cultivating) {
      try {
        // Phase 11.8.D + 11.8.E — Buff mods fetch once per character per tick:
        //   - `cultivationBlocked` (Tâm Ma) → skip toàn bộ EXP gain (continue).
        //   - `hpRegenFlat` / `mpRegenFlat` (per-second values) → multiply
        //     `tickSeconds` apply trên hp/mp (cap LEAST hpMax/mpMax).
        // Service không inject → identity (không block, không regen).
        const buffMods = this.buffs ? await this.buffs.getMods(c.id) : null;
        if (buffMods?.cultivationBlocked) {
          // Catalog `debuff_taoma` description "công kích -10% và không thể tu
          // luyện" → tick này skip EXP gain + mission/achievement track +
          // realtime emit. Stamina regen ở trên vẫn áp dụng (không phụ thuộc).
          // Hp/mp regen cũng skip — character đang Tâm Ma không hồi phục.
          continue;
        }
        // EXP gain = rateForRealm(realm) + floor(spirit/4).
        // rateForRealm scale 1.45^order → tu luyện ở cảnh giới cao có base rate
        // cao hơn, bù lại expCostForStage cũng cao hơn.
        const realmRate = cultivationRateForRealm(
          c.realmKey,
          CULTIVATION_TICK_BASE_EXP,
        );
        const baseGain = realmRate + Math.floor(c.spirit / 4);
        // Phase 11.3.C — Linh căn cultivationMultiplier wire.
        // Legacy character (spiritualRootGrade=null) → multiplier=1.0 → backward-compat.
        const cultivationMul = isValidSpiritualRootGrade(c.spiritualRootGrade)
          ? getSpiritualRootGradeDef(c.spiritualRootGrade).cultivationMultiplier
          : 1.0;
        // Phase 11.1.B — Công pháp (CultivationMethod) `expMultiplier` wire.
        // Compose với linh căn cultivationMul. Legacy character (no method
        // equipped) → methodMul=1.0 → backward-compat.
        const methodMul = methodExpMultiplierFor(c.equippedCultivationMethodKey);
        // Phase 11.1.E — Linh căn × Cultivation Method element affinity bonus.
        // Compose: methodMul × (1 + bonus) trong đó bonus ∈ {0, 0.05, 0.1}:
        //   - primary === method.element → +10% (`METHOD_ELEMENT_PRIMARY_BONUS`)
        //   - method.element ∈ secondaryElements → +5% (`METHOD_ELEMENT_SECONDARY_BONUS`)
        //   - khác hệ / method vô hệ / legacy null → 0 (identity)
        // Source-of-truth: `cultivation-methods.ts` JSDoc top + helper
        // `computeMethodElementAffinityForCharacter`. Element affinity là
        // bonus EXP (≠ stat bonus / damage bonus combat — wire riêng).
        const methodElementAffinityBonus = computeMethodElementAffinityForCharacter(
          c.primaryElement,
          c.secondaryElements,
          c.equippedCultivationMethodKey,
        );
        const methodElementAffinityMul = 1 + methodElementAffinityBonus;
        // Phase 11.7.D + 11.7.E — Talent (Thần Thông) mods fetch ONCE per
        // character per tick. `expMul` wire vào EXP gain compose; `hpRegenFlat`
        // / `mpRegenFlat` (per-second values) wire vào hp/mp regen branch.
        // Catalog producer:
        //   - `talent_ngo_dao` (passive expMul +15%, Phase 11.7.D).
        //   - `talent_moc_linh_quy` (passive regen 5 hpMax per-second, Phase
        //     11.7.E — Mộc Linh Quy "Linh khí mộc tự hồi, +5 HP regen mỗi tick
        //     combat", giờ apply cả cultivation tick).
        // Compose multiplicatively: cultivationMul × methodMul ×
        // methodElementAffinityMul × talentExpMul.
        // Compose additively buff + talent regen (cả hai đều "per-second flat").
        // Legacy character (no talent learned) hoặc service không inject →
        // talentMods=null → expMul=1.0, hpRegenFlat/mpRegenFlat=0 identity.
        const talentMods = this.talents
          ? await this.talents.getMods(c.id)
          : null;
        const talentExpMul = talentMods?.expMul ?? 1;
        // Phase 11 nâng cao §5 PR2 wire — Tâm Ma debuff (`tam_ma_light`) áp
        // `cultivation_rate_mul ×0.7` vào EXP gain trong 300s sau breakthrough
        // fail. Compose multiplicatif sau talentExpMul (BuffMods.cultivationRateMul
        // default 1 identity nếu không có buff). Pure debuff path (không stack
        // buff khác hiện tại — single source `breakthrough` `tam_ma_light`).
        const buffCultivationRateMul = buffMods?.cultivationRateMul ?? 1;
        // Phase 26.3 — Cultivation Method V2 aggregated equipped bonus.
        // `computeMethodCultivationRateBonus` returns `1 + qiExpPercent/100`
        // (clamped ở `aggregateEquippedMethods` qua `METHOD_BONUS_CAPS`).
        // Legacy character chưa unlock V2 → snapshot=[] → mul=1.0.
        let methodV2Mul = 1.0;
        if (this.cultivationMethodV2) {
          try {
            const snapshot = await this.cultivationMethodV2.getEquippedSnapshot(c.id);
            methodV2Mul = computeMethodCultivationRateBonus(snapshot);
          } catch {
            methodV2Mul = 1.0;
          }
        }
        // Phase 15.2 — compose LiveOps `CULTIVATION_EXP_BOOST` vào cuối
        // chuỗi multiplier (sau cultivation/method/element/talent/buff).
        // Server-authoritative cap ≤ 2.0 — multiplier đã clamp ở service.
        const requestedGain = BigInt(
          Math.max(
            1,
            Math.round(
              baseGain *
                cultivationMul *
                methodMul *
                methodElementAffinityMul *
                methodV2Mul *
                talentExpMul *
                buffCultivationRateMul *
                liveOpsExpMul,
            ),
          ),
        );

        // Phase 16.5 — Daily Reward Cap. Wrap cap apply + CAS update vào
        // 1 transaction để bucket accum + character.exp atomic. Nếu CAS
        // miss (race với worker khác cùng tick), throw để Prisma rollback
        // toàn bộ transaction (bucket update revert) — không double-count.
        // Cap = 0 (đã hết quota) → vẫn rollback bucket (chưa add) nhưng
        // skip side effects (mission track, realtime emit).
        const txOutcome = await this.prisma.$transaction(async (tx) => {
          const cap = await this.rewardCap.applyCapTx(tx, {
            characterId: c.id,
            source: 'CULTIVATION',
            requestedExp: requestedGain,
            requestedLinhThach: 0n,
            realmKey: c.realmKey,
            refType: 'CultivationTick',
            meta: { jobName: job.name },
          });

          if (cap.grantedExp === 0n) {
            // Hết cap ngày — skip tick này. Stamina regen ở batch
            // ngoài transaction đã chạy, mission track / achievement /
            // realtime emit skip.
            return { kind: 'capped' as const, cap };
          }

          const grantedGain = cap.grantedExp;
          let exp = c.exp + grantedGain;
          let realmKey = c.realmKey;
          let realmStage = c.realmStage;
          let brokeThrough = false;

          let stageCost = expCostForStage(realmKey, realmStage);
          while (stageCost !== null && exp >= stageCost && realmStage < 9) {
            exp -= stageCost;
            realmStage += 1;
            brokeThrough = true;
            stageCost = expCostForStage(realmKey, realmStage);
          }

          const updateResult = await tx.character.updateMany({
            where: {
              id: c.id,
              exp: c.exp,
              realmStage: c.realmStage,
              cultivating: true,
            },
            data: { exp, realmStage },
          });
          if (updateResult.count === 0) {
            // CAS miss — throw để rollback bucket update.
            throw new Error('CAS_MISS');
          }
          return {
            kind: 'granted' as const,
            grantedGain,
            exp,
            realmStage,
            brokeThrough,
            cap,
          };
        }).catch((err: unknown) => {
          if (err instanceof Error && err.message === 'CAS_MISS') {
            return { kind: 'cas_miss' as const };
          }
          throw err;
        });

        if (txOutcome.kind === 'cas_miss' || txOutcome.kind === 'capped') {
          // CAS miss hoặc đã cap → skip side effects (mission track,
          // hp/mp regen, realtime emit). Bucket update đã rollback (CAS)
          // hoặc giữ nguyên 0 grant (cap).
          continue;
        }

        const exp = txOutcome.exp;
        const realmStage = txOutcome.realmStage;
        const realmKey = c.realmKey;
        const brokeThrough = txOutcome.brokeThrough;

        // Phase 11.8.E + 11.7.E — Buff `hpRegenFlat` / `mpRegenFlat` wire +
        // Talent regen wire. Catalog values là per-second (vd
        // `pill_hp_regen_t1` "+5 HP/giây", `sect_aura_thuy` "+4 MP/giây trong
        // tu luyện", `talent_moc_linh_quy` "+5 HP regen"). Compose ADDITIVELY
        // buff + talent regen (cả hai đều flat per-second values). Mỗi tick =
        // 30s → tổng hồi = `(buff + talent) × tickSeconds`. Cap LEAST(hp+delta,
        // hpMax) qua raw SQL để không vượt cap. Skip nếu cả hp/mp regen = 0
        // (avoid no-op write). Đặt SAU CAS guard để 2 worker race chỉ
        // regen 1 lần (CAS thắng), không double-regen.
        const totalHpRegenFlat =
          (buffMods?.hpRegenFlat ?? 0) + (talentMods?.hpRegenFlat ?? 0);
        const totalMpRegenFlat =
          (buffMods?.mpRegenFlat ?? 0) + (talentMods?.mpRegenFlat ?? 0);
        if (totalHpRegenFlat > 0 || totalMpRegenFlat > 0) {
          const tickSeconds = Math.round(CULTIVATION_TICK_MS / 1000);
          const hpDelta = Math.floor(totalHpRegenFlat * tickSeconds);
          const mpDelta = Math.floor(totalMpRegenFlat * tickSeconds);
          if (hpDelta > 0 || mpDelta > 0) {
            await this.prisma.$executeRawUnsafe(
              `UPDATE "Character" SET hp = LEAST("hpMax", hp + $1), mp = LEAST("mpMax", mp + $2) WHERE id = $3`,
              hpDelta,
              mpDelta,
              c.id,
            );
          }
        }

        // Mission + Achievement tracking — mỗi tick cộng seconds + exp gained,
        // cộng 1 BREAKTHROUGH nếu đột phá. Không throw nếu service lỗi — tu
        // luyện là core loop, không để mission/achievement chặn EXP gain.
        // Phase 11.10.C-2 wire trackEvent vào achievement bằng cùng goalKind.
        try {
          const cultivateSeconds = Math.round(CULTIVATION_TICK_MS / 1000);
          await this.missions.track(
            c.id,
            'CULTIVATE_SECONDS',
            cultivateSeconds,
          );
          await this.missions.track(
            c.id,
            'GAIN_EXP',
            Number(txOutcome.grantedGain),
          );
          if (brokeThrough) {
            await this.missions.track(c.id, 'BREAKTHROUGH', 1);
          }
          if (this.achievements) {
            await this.achievements.trackEvent(
              c.id,
              'CULTIVATE_SECONDS',
              cultivateSeconds,
            );
            await this.achievements.trackEvent(
              c.id,
              'GAIN_EXP',
              Number(txOutcome.grantedGain),
            );
            if (brokeThrough) {
              await this.achievements.trackEvent(c.id, 'BREAKTHROUGH', 1);
            }
          }
        } catch (e) {
          this.logger.warn(
            `mission/achievement track failed for char=${c.id}: ${(e as Error).message}`,
          );
        }

        const expNext = expCostForStage(realmKey, realmStage);
        const payload: CultivateTickPayload = {
          characterId: c.id,
          expGained: txOutcome.grantedGain.toString(),
          exp: exp.toString(),
          expNext: (expNext ?? 0n).toString(),
          realmKey,
          realmStage,
          brokeThrough,
        };
        this.realtime.emitToUser(c.userId, 'cultivate:tick', payload);
      } catch (e) {
        this.logger.error(`tick failed for char=${c.id}: ${(e as Error).message}`);
      }
    }
  }
}
