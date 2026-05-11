import { Injectable, Logger } from '@nestjs/common';
import {
  SECT_SEASONS,
  previousTerritoryPeriodKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritoryDecayService } from '../territory/territory-decay.service';
import { TerritoryRewardService } from '../territory/territory-reward.service';
import { TerritorySettlementService } from '../territory/territory-settlement.service';
import { SectSeasonHistoryService } from '../sect-season/sect-season-history.service';
import { SectSeasonRewardService } from '../sect-season/sect-season-reward.service';
import { LiveOpsCronLease } from './liveops-cron.lease';

/**
 * Phase 13.2.D + 14.0.F — Live Ops cron orchestration service.
 *
 * Service KHÔNG owning state — chỉ orchestrate gọi service đã có:
 *   - Territory: settle previous period → decay → grant owner reward mail.
 *   - Sect Season: snapshot mọi season đã `endsAt <= now` mà chưa
 *     snapshot.
 *
 * Idempotency / race-safety:
 *   - Mọi service được gọi đều idempotent qua UNIQUE constraint ở DB:
 *     `SectTerritorySettlementSnapshot(regionKey, periodKey)`,
 *     `SectTerritoryDecayLog(periodKey)`,
 *     `TerritoryOwnerRewardGrant(periodKey, regionKey, characterId)`,
 *     `SectSeasonSnapshot(seasonKey)`.
 *   - Optional Redis lease (xem `LiveOpsCronLease`) là barrier optimistic
 *     để tránh 2 node cùng làm cùng 1 cycle (giảm log noise + DB load).
 *     KHÔNG phải nguồn sự thật idempotency — DB guard mới là final.
 *
 * Logging: mọi cycle đều log `start` + `done` + `summary` với periodKey
 * + counts. Lỗi không-fatal (vd Redis ping fail) chỉ warn, không throw.
 *
 * Out-of-scope (defer):
 *   - Sect season auto reward distribution: Phase 13.2.D chỉ snapshot
 *     idempotent (để Hall of Fame + history có dữ liệu). Reward grant
 *     đợi design rõ — TODO trong code.
 *   - Per-region decay rate khác nhau: dùng default `TERRITORY_DECAY_DEFAULT_BPS`.
 */

export interface TerritoryCycleSummary {
  periodKey: string;
  /** Số region đã settle trong run này (skipped/empty không tính). */
  territorySettled: number;
  /** Region rỗng (mọi sect 0 điểm) — settle skipped. */
  territorySkipped: number;
  /** True nếu decay log đã tồn tại trước đó (skipped). */
  territoryDecaySkipped: boolean;
  /** Tổng influence delta sau decay (0 nếu skipped). */
  territoryDecayDelta: number;
  /** Số mail owner reward MỚI tạo ra (loại trừ already-granted). */
  rewardMailsCreated: number;
  /** Số grant đã tồn tại (skipped, idempotency hit). */
  rewardSkippedAlreadyGranted: number;
  /** Errors fail-soft: stage + message. Cycle vẫn return summary. */
  errors: ReadonlyArray<{ stage: string; message: string }>;
}

export interface SectSeasonCycleSummary {
  /** Số season đã snapshot trong run này (mới hoặc đã có). */
  seasonSnapshotsCreated: number;
  /** Số season đã có snapshot từ trước (skipped). */
  seasonSnapshotsSkipped: number;
  /** Danh sách seasonKey đã xử lý theo thứ tự. */
  seasonsProcessed: ReadonlyArray<string>;
  /** Phase 15.7 — số mail Champion grant mới (per-member của sect rank-1). */
  championMailsCreated: number;
  /** Phase 15.7 — số grant Champion đã tồn tại (idempotent skip). */
  championAlreadyGranted: number;
  /** Phase 15.7 — số mail MVP grant mới (top-1 individual). */
  mvpMailsCreated: number;
  /** Phase 15.7 — số grant MVP đã tồn tại (idempotent skip). */
  mvpAlreadyGranted: number;
  errors: ReadonlyArray<{ stage: string; seasonKey: string; message: string }>;
}

export interface WeeklyCycleSummary {
  startedAt: string;
  finishedAt: string;
  /** True nếu lease cho key tổng đã bị giữ — toàn cycle skipped. */
  skippedAlreadyDone: boolean;
  territory: TerritoryCycleSummary;
  sectSeason: SectSeasonCycleSummary;
  /** triggeredBy = userId admin (force-run) hoặc null nếu cron. */
  triggeredBy: string | null;
}

export interface LiveOpsCronRunOptions {
  /** Override periodKey territory (default: previousTerritoryPeriodKey). */
  periodKey?: string;
  /** Triggered by admin userId (audit trail). */
  triggeredBy?: string | null;
  /** Bypass lease (force-run admin). KHÔNG TIN — DB guard vẫn block. */
  bypassLease?: boolean;
  /** Override `now` cho test (sect season snapshot due check). */
  now?: Date;
}

const TERRITORY_LEASE_KEY = 'xt:liveops-cron:territory';
const SECT_SEASON_LEASE_KEY = 'xt:liveops-cron:sect-season';
const WEEKLY_LEASE_KEY = 'xt:liveops-cron:weekly-cycle';

@Injectable()
export class LiveOpsCronService {
  private readonly logger = new Logger(LiveOpsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: TerritorySettlementService,
    private readonly decay: TerritoryDecayService,
    private readonly reward: TerritoryRewardService,
    private readonly seasonHistory: SectSeasonHistoryService,
    private readonly seasonReward: SectSeasonRewardService,
    private readonly lease: LiveOpsCronLease,
  ) {}

  /**
   * Chạy 1 chu kỳ tuần đầy đủ: territory cycle + sect season snapshot.
   *
   * Lease pattern:
   *   - `WEEKLY_LEASE_KEY` (5 phút) chiếm trước mỗi inner cycle. Nếu lose
   *     → return early `skippedAlreadyDone=true`.
   *   - Inner cycle (territory / sect-season) tự lease key riêng — lease
   *     overlap OK vì SET NX EX trên key khác.
   *
   * Trả {@link WeeklyCycleSummary} ngay cả khi 1 stage fail-soft (errors[]
   * chứa chi tiết). Throw chỉ khi exception ngoài DB unique guard.
   */
  async runWeeklyCycle(
    opts: LiveOpsCronRunOptions = {},
    leaseTtlSec = 300,
  ): Promise<WeeklyCycleSummary> {
    const startedAt = new Date();
    const triggeredBy = opts.triggeredBy ?? null;
    const bypass = opts.bypassLease === true;

    let outerOwner: string | null = null;
    if (!bypass) {
      const r = await this.lease.acquire(WEEKLY_LEASE_KEY, leaseTtlSec);
      if (!r.acquired) {
        this.logger.log(
          `runWeeklyCycle lease busy → skip (triggeredBy=${triggeredBy ?? 'cron'})`,
        );
        return {
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          skippedAlreadyDone: true,
          territory: this.emptyTerritorySummary(
            opts.periodKey ?? previousTerritoryPeriodKey(opts.now),
          ),
          sectSeason: this.emptySectSeasonSummary(),
          triggeredBy,
        };
      }
      outerOwner = r.owner;
    }

    try {
      const territory = await this.runTerritoryCycle(opts, leaseTtlSec);
      const sectSeason = await this.runSectSeasonCycle(opts, leaseTtlSec);
      const finishedAt = new Date();
      this.logger.log(
        `runWeeklyCycle done period=${territory.periodKey} settled=${territory.territorySettled} ` +
          `decaySkipped=${territory.territoryDecaySkipped} mails=${territory.rewardMailsCreated} ` +
          `seasonSnap=${sectSeason.seasonSnapshotsCreated} (triggeredBy=${triggeredBy ?? 'cron'})`,
      );
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        skippedAlreadyDone: false,
        territory,
        sectSeason,
        triggeredBy,
      };
    } finally {
      if (outerOwner) {
        await this.lease.release(WEEKLY_LEASE_KEY, outerOwner);
      }
    }
  }

  /**
   * Territory weekly cycle: settle previous period → decay → grant owner
   * reward mail. Mỗi stage idempotent qua DB UNIQUE; lỗi fail-soft đẩy
   * vào `errors[]` để cycle còn lại không bị block.
   */
  async runTerritoryCycle(
    opts: LiveOpsCronRunOptions = {},
    leaseTtlSec = 300,
  ): Promise<TerritoryCycleSummary> {
    const periodKey = opts.periodKey ?? previousTerritoryPeriodKey(opts.now);
    const triggeredBy = opts.triggeredBy ?? null;
    const errors: { stage: string; message: string }[] = [];

    let leaseOwner: string | null = null;
    if (opts.bypassLease !== true) {
      const r = await this.lease.acquire(TERRITORY_LEASE_KEY, leaseTtlSec);
      if (!r.acquired) {
        this.logger.log(
          `runTerritoryCycle lease busy period=${periodKey} → skip`,
        );
        return this.emptyTerritorySummary(periodKey);
      }
      leaseOwner = r.owner;
    }

    let settled = 0;
    let skippedRegions = 0;
    let decaySkipped = false;
    let decayDelta = 0;
    let mailsCreated = 0;
    let mailsAlreadyGranted = 0;

    this.logger.log(
      `runTerritoryCycle start period=${periodKey} (triggeredBy=${triggeredBy ?? 'cron'})`,
    );

    try {
      try {
        const settleRes = await this.settlement.settleAllRegions(periodKey, {
          settledBy: triggeredBy,
        });
        settled = settleRes.snapshots.length;
        skippedRegions = settleRes.skippedRegions.length;
      } catch (e) {
        const message = (e as Error).message;
        this.logger.error(`territory settle failed: ${message}`);
        errors.push({ stage: 'settle', message });
      }

      try {
        const decayRes = await this.decay.decay({
          periodKey,
          triggeredBy,
        });
        decaySkipped = decayRes.skipped;
        decayDelta = decayRes.delta;
      } catch (e) {
        const message = (e as Error).message;
        this.logger.error(`territory decay failed: ${message}`);
        errors.push({ stage: 'decay', message });
      }

      try {
        const rewardRes = await this.reward.grantWeeklyOwnerRewardMail(
          periodKey,
          { triggeredBy },
        );
        mailsCreated = rewardRes.mailsCreated;
        mailsAlreadyGranted = rewardRes.skippedAlreadyGranted;
      } catch (e) {
        const message = (e as Error).message;
        this.logger.error(`territory reward grant failed: ${message}`);
        errors.push({ stage: 'reward', message });
      }
    } finally {
      if (leaseOwner) {
        await this.lease.release(TERRITORY_LEASE_KEY, leaseOwner);
      }
    }

    this.logger.log(
      `runTerritoryCycle done period=${periodKey} settled=${settled} skipped=${skippedRegions} ` +
        `decaySkipped=${decaySkipped} decayDelta=${decayDelta} mails=${mailsCreated} ` +
        `alreadyGranted=${mailsAlreadyGranted} errors=${errors.length}`,
    );

    return {
      periodKey,
      territorySettled: settled,
      territorySkipped: skippedRegions,
      territoryDecaySkipped: decaySkipped,
      territoryDecayDelta: decayDelta,
      rewardMailsCreated: mailsCreated,
      rewardSkippedAlreadyGranted: mailsAlreadyGranted,
      errors,
    };
  }

  /**
   * Sect season cycle: snapshot mọi season `endsAt <= now` mà chưa
   * snapshot. Idempotent qua UNIQUE `seasonKey` ở `SectSeasonSnapshot`.
   *
   * Phase 13.2.D KHÔNG distribute reward — chỉ snapshot history/HoF (đã
   * đủ để FE render). Reward grant đợi design — TODO ở code.
   */
  async runSectSeasonCycle(
    opts: LiveOpsCronRunOptions = {},
    leaseTtlSec = 300,
  ): Promise<SectSeasonCycleSummary> {
    const now = opts.now ?? new Date();
    const triggeredBy = opts.triggeredBy ?? null;
    const errors: { stage: string; seasonKey: string; message: string }[] = [];

    let leaseOwner: string | null = null;
    if (opts.bypassLease !== true) {
      const r = await this.lease.acquire(SECT_SEASON_LEASE_KEY, leaseTtlSec);
      if (!r.acquired) {
        this.logger.log(`runSectSeasonCycle lease busy → skip`);
        return this.emptySectSeasonSummary();
      }
      leaseOwner = r.owner;
    }

    let created = 0;
    let alreadyExisted = 0;
    const processed: string[] = [];
    let championMailsCreated = 0;
    let championAlreadyGranted = 0;
    let mvpMailsCreated = 0;
    let mvpAlreadyGranted = 0;

    this.logger.log(
      `runSectSeasonCycle start now=${now.toISOString()} (triggeredBy=${triggeredBy ?? 'cron'})`,
    );

    try {
      // Catalog ổn định ~10 season → linear scan OK.
      const dueSeasons = SECT_SEASONS.filter(
        (s) => new Date(s.endsAtIso).getTime() <= now.getTime(),
      );
      // Snapshot existence check trước khi gọi service — phân biệt
      // "đã tồn tại" vs "mới tạo" cho summary report.
      const existingKeys = new Set(
        (
          await this.prisma.sectSeasonSnapshot.findMany({
            where: { seasonKey: { in: dueSeasons.map((s) => s.key) } },
            select: { seasonKey: true },
          })
        ).map((r) => r.seasonKey),
      );

      for (const s of dueSeasons) {
        const wasExisting = existingKeys.has(s.key);
        try {
          await this.seasonHistory.snapshotSeason(s.key, { now });
          processed.push(s.key);
          if (wasExisting) alreadyExisted++;
          else created++;
        } catch (e) {
          const message = (e as Error).message;
          this.logger.warn(
            `sect-season snapshot failed key=${s.key}: ${message}`,
          );
          errors.push({ stage: 'snapshot', seasonKey: s.key, message });
          // Snapshot fail → KHÔNG grant reward (snapshot là tiền đề).
          continue;
        }

        // Phase 15.7 — Champion / MVP reward distribution. Idempotent
        // qua DB UNIQUE `(seasonKey, rewardType, characterId)`. Chạy lại
        // cùng season key KHÔNG gửi mail trùng.
        try {
          const r = await this.seasonReward.grantSeasonRewards(s.key, {
            triggeredBy,
          });
          championMailsCreated += r.championMailsCreated;
          championAlreadyGranted += r.championAlreadyGranted;
          mvpMailsCreated += r.mvpMailsCreated;
          mvpAlreadyGranted += r.mvpAlreadyGranted;
        } catch (e) {
          const message = (e as Error).message;
          this.logger.warn(
            `sect-season reward grant failed key=${s.key}: ${message}`,
          );
          errors.push({ stage: 'reward', seasonKey: s.key, message });
        }
      }
    } finally {
      if (leaseOwner) {
        await this.lease.release(SECT_SEASON_LEASE_KEY, leaseOwner);
      }
    }

    this.logger.log(
      `runSectSeasonCycle done created=${created} skipped=${alreadyExisted} ` +
        `processed=${processed.length} ` +
        `champMail=${championMailsCreated}/+${championAlreadyGranted} ` +
        `mvpMail=${mvpMailsCreated}/+${mvpAlreadyGranted} ` +
        `errors=${errors.length}`,
    );

    return {
      seasonSnapshotsCreated: created,
      seasonSnapshotsSkipped: alreadyExisted,
      seasonsProcessed: processed,
      championMailsCreated,
      championAlreadyGranted,
      mvpMailsCreated,
      mvpAlreadyGranted,
      errors,
    };
  }

  private emptyTerritorySummary(periodKey: string): TerritoryCycleSummary {
    return {
      periodKey,
      territorySettled: 0,
      territorySkipped: 0,
      territoryDecaySkipped: false,
      territoryDecayDelta: 0,
      rewardMailsCreated: 0,
      rewardSkippedAlreadyGranted: 0,
      errors: [],
    };
  }

  private emptySectSeasonSummary(): SectSeasonCycleSummary {
    return {
      seasonSnapshotsCreated: 0,
      seasonSnapshotsSkipped: 0,
      seasonsProcessed: [],
      championMailsCreated: 0,
      championAlreadyGranted: 0,
      mvpMailsCreated: 0,
      mvpAlreadyGranted: 0,
      errors: [],
    };
  }
}
