import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SECT_SEASON_CHAMPION_MEMBER_CAP,
  SECT_SEASON_CHAMPION_REWARD,
  SECT_SEASON_MVP_REWARD,
  sectSeasonByKey,
  type SectSeasonRewardDef,
  type SectSeasonRewardType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 15.7 — Sect Season Champion / MVP reward grant runtime.
 *
 * Server-authoritative invariants:
 *   - Idempotency qua composite UNIQUE
 *     `(seasonKey, rewardType, characterId)` ở `SectSeasonRewardGrant`.
 *     Cron / admin trigger lại cùng season KHÔNG gửi mail trùng.
 *   - Race-safe: 2 concurrent caller cùng `(season, type, char)` chỉ 1
 *     winner ghi grant + tạo mail. Loser P2002 → skip.
 *   - Snapshot rule: nhận thưởng theo MEMBER HIỆN TẠI tại thời điểm
 *     grant (`Character.sectId === championSectId` lúc query). Nếu
 *     member rời sect sau season finalize nhưng trước grant → KHÔNG
 *     nhận thưởng. Nếu member join sau finalize → vẫn nhận thưởng.
 *     Document trong `BALANCE_MODEL.md` §sect-season §15.7.
 *   - Champion member cap {@link SECT_SEASON_CHAMPION_MEMBER_CAP}: nếu
 *     sect quá đông member, lấy theo `characterId ASC` (deterministic).
 *
 * Reward delivery 100% qua mail (`Mail` table) — KHÔNG `CurrencyService.
 * applyTx` trực tiếp ở đây (player phải tự `MAIL_CLAIM` để credit).
 * Audit row vẫn track grant qua `SectSeasonRewardGrant.rewardJson`
 * snapshot.
 *
 * Wiring:
 *   - Gọi từ `LiveOpsCronService.runSectSeasonCycle` SAU khi
 *     `snapshotSeason()` thành công (snapshot có `championSectId` +
 *     `mvpCharacterId` denormalized).
 *   - Cũng được expose qua admin endpoint manual grant cho 1 season
 *     cụ thể (fallback nếu cron skip).
 */

export type SectSeasonRewardError =
  | 'SEASON_NOT_FOUND'
  | 'SNAPSHOT_NOT_FOUND';

export class SectSeasonRewardServiceError extends Error {
  readonly code: SectSeasonRewardError;
  constructor(code: SectSeasonRewardError, message?: string) {
    super(message ?? code);
    this.name = 'SectSeasonRewardServiceError';
    this.code = code;
  }
}

export interface SectSeasonRewardGrantSummary {
  seasonKey: string;
  /** True nếu snapshot có `championSectId` set. */
  championAvailable: boolean;
  /** True nếu snapshot có `mvpCharacterId` set. */
  mvpAvailable: boolean;
  /** Số mail CHAMPION mới tạo (loại trừ already-granted). */
  championMailsCreated: number;
  /** Số grant CHAMPION đã tồn tại (skip). */
  championAlreadyGranted: number;
  /** Số member của champion sect tại thời điểm grant (sau cap). */
  championMemberCount: number;
  /**
   * Phase 15.8 — True nếu champion grant dùng membership snapshot
   * (`SectSeasonChampionSnapshot`). False nếu fallback current membership
   * (legacy season pre-15.8 không có snapshot).
   */
  championUsedSnapshot: boolean;
  /** Số mail MVP mới tạo (0 hoặc 1). */
  mvpMailsCreated: number;
  /** Số grant MVP đã tồn tại (0 hoặc 1). */
  mvpAlreadyGranted: number;
  /** True nếu bypass mọi mutation (dryRun). */
  dryRun: boolean;
}

export interface SectSeasonRewardGrantOptions {
  /** ADMIN userId từ AdminGuard — denormalized vào `Mail.createdByAdminId`. */
  triggeredBy?: string | null;
  /** Nếu true: KHÔNG mutate state. */
  dryRun?: boolean;
}

const SYSTEM_SENDER_NAME = 'Thiên Đạo Sứ Giả — Mùa Tông Môn';

@Injectable()
export class SectSeasonRewardService {
  private readonly logger = new Logger(SectSeasonRewardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grant Champion + MVP reward cho 1 season. Idempotent — gọi lại cùng
   * `seasonKey` không gửi mail trùng.
   *
   * Throws:
   *   - `SEASON_NOT_FOUND`: `seasonKey` không có trong shared catalog.
   *   - `SNAPSHOT_NOT_FOUND`: chưa snapshot — caller phải gọi
   *     `SectSeasonHistoryService.snapshotSeason` trước.
   */
  async grantSeasonRewards(
    seasonKey: string,
    opts: SectSeasonRewardGrantOptions = {},
  ): Promise<SectSeasonRewardGrantSummary> {
    if (!sectSeasonByKey(seasonKey)) {
      throw new SectSeasonRewardServiceError('SEASON_NOT_FOUND');
    }
    const dryRun = opts.dryRun === true;
    const triggeredBy = opts.triggeredBy ?? null;

    const snapshot = await this.prisma.sectSeasonSnapshot.findUnique({
      where: { seasonKey },
      select: {
        championSectId: true,
        mvpCharacterId: true,
        mvpSectId: true,
      },
    });
    if (!snapshot) {
      throw new SectSeasonRewardServiceError('SNAPSHOT_NOT_FOUND');
    }

    const championAvailable = !!snapshot.championSectId;
    const mvpAvailable = !!snapshot.mvpCharacterId;

    let championMailsCreated = 0;
    let championAlreadyGranted = 0;
    let championMemberCount = 0;
    let mvpMailsCreated = 0;
    let mvpAlreadyGranted = 0;
    let championUsedSnapshot = false;

    // ── Champion: per-member của sect rank-1 ──
    if (snapshot.championSectId) {
      // Phase 15.8 — prefer membership snapshot (audit-perfect: grant
      // dựa trên member tại finalize, không phải current). Fallback
      // current membership nếu snapshot không tồn tại (legacy season).
      const champSnapshot =
        await this.prisma.sectSeasonChampionSnapshot.findUnique({
          where: {
            seasonKey_sectId_rank: {
              seasonKey,
              sectId: snapshot.championSectId,
              rank: 1,
            },
          },
          select: { memberCharacterIdsJson: true },
        });

      let memberIds: string[];
      if (champSnapshot) {
        championUsedSnapshot = true;
        const raw = champSnapshot.memberCharacterIdsJson;
        memberIds = Array.isArray(raw)
          ? raw.filter((v): v is string => typeof v === 'string')
          : [];
      } else {
        this.logger.warn(
          `grantSeasonRewards season=${seasonKey} championMembershipSnapshot missing → fallback current membership (legacy season pre-15.8)`,
        );
        const members = await this.prisma.character.findMany({
          where: { sectId: snapshot.championSectId },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: SECT_SEASON_CHAMPION_MEMBER_CAP,
        });
        memberIds = members.map((m) => m.id);
      }

      championMemberCount = memberIds.length;
      for (const characterId of memberIds) {
        const r = await this.grantOne({
          seasonKey,
          rewardType: 'CHAMPION',
          characterId,
          sectId: snapshot.championSectId,
          rewardDef: SECT_SEASON_CHAMPION_REWARD,
          triggeredBy,
          dryRun,
        });
        if (r === 'created') championMailsCreated++;
        else championAlreadyGranted++;
      }
    }

    // ── MVP: top-1 cá nhân ──
    if (snapshot.mvpCharacterId) {
      const r = await this.grantOne({
        seasonKey,
        rewardType: 'MVP',
        characterId: snapshot.mvpCharacterId,
        sectId: snapshot.mvpSectId,
        rewardDef: SECT_SEASON_MVP_REWARD,
        triggeredBy,
        dryRun,
      });
      if (r === 'created') mvpMailsCreated = 1;
      else mvpAlreadyGranted = 1;
    }

    this.logger.log(
      `grantSeasonRewards season=${seasonKey} champ=${championMailsCreated}/+${championAlreadyGranted} mvp=${mvpMailsCreated}/+${mvpAlreadyGranted} dryRun=${dryRun}`,
    );

    return {
      seasonKey,
      championAvailable,
      mvpAvailable,
      championMailsCreated,
      championAlreadyGranted,
      championMemberCount,
      championUsedSnapshot,
      mvpMailsCreated,
      mvpAlreadyGranted,
      dryRun,
    };
  }

  /**
   * Grant 1 reward (1 character / 1 season / 1 type) — atomic transaction
   * cho insert grant row + Mail row. Trả `created` nếu mới grant,
   * `existed` nếu đã có (idempotent skip).
   *
   * Race-safe: catch P2002 (unique violation) → trả `existed`. Caller
   * không cần wrap.
   *
   * dryRun: SKIP mọi mutation, chỉ check existing.
   */
  private async grantOne(input: {
    seasonKey: string;
    rewardType: SectSeasonRewardType;
    characterId: string;
    sectId: string | null;
    rewardDef: SectSeasonRewardDef;
    triggeredBy: string | null;
    dryRun: boolean;
  }): Promise<'created' | 'existed'> {
    const existing = await this.prisma.sectSeasonRewardGrant.findUnique({
      where: {
        seasonKey_rewardType_characterId: {
          seasonKey: input.seasonKey,
          rewardType: input.rewardType,
          characterId: input.characterId,
        },
      },
      select: { id: true },
    });
    if (existing) return 'existed';
    if (input.dryRun) return 'created';

    const rewardJson: Prisma.InputJsonValue = {
      linhThach: input.rewardDef.linhThach,
      exp: input.rewardDef.exp,
      itemRewards: input.rewardDef.itemRewards.map((it) => ({
        itemKey: it.itemKey,
        qty: it.qty,
      })),
    };
    const itemsJson: Prisma.InputJsonValue = input.rewardDef.itemRewards.map(
      (it) => ({ itemKey: it.itemKey, qty: it.qty }),
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        const grant = await tx.sectSeasonRewardGrant.create({
          data: {
            seasonKey: input.seasonKey,
            rewardType: input.rewardType,
            characterId: input.characterId,
            sectId: input.sectId,
            mailId: null,
            rewardJson,
          },
          select: { id: true },
        });
        const mail = await tx.mail.create({
          data: {
            recipientId: input.characterId,
            senderName: SYSTEM_SENDER_NAME,
            subject: input.rewardDef.subjectVi,
            body: input.rewardDef.bodyVi,
            rewardLinhThach: BigInt(input.rewardDef.linhThach),
            rewardTienNgoc: 0,
            rewardExp: BigInt(input.rewardDef.exp),
            rewardItems: itemsJson,
            createdByAdminId: input.triggeredBy ?? null,
          },
          select: { id: true },
        });
        await tx.sectSeasonRewardGrant.update({
          where: { id: grant.id },
          data: { mailId: mail.id },
        });
      });
      return 'created';
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Race lose — leader đã insert grant + mail xong. Coi như existed.
        return 'existed';
      }
      throw e;
    }
  }
}
