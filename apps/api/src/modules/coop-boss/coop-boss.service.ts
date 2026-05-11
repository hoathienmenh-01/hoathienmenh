import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CoopBossContributionTier as PrismaCoopBossContributionTier,
  CoopBossRewardClaimStatus as PrismaCoopBossRewardClaimStatus,
  CoopBossStatus as PrismaCoopBossStatus,
  CurrencyKind,
  PartyStatus as PrismaPartyStatus,
  Prisma,
} from '@prisma/client';
import {
  COOP_BOSS_LIMITS,
  applyLeechRiskDowngrade,
  bossByKey,
  buildCoopBossRunRefId,
  canClaimCoopBossReward,
  classifyContributionTier,
  classifyCoopLeechRisk,
  clampContributionInput,
  computeContributionScore,
  computeCoopBossRewardTier,
  type CoopBossContributionDto,
  type CoopBossContributionTier,
  type CoopBossContributionUpdatedBroadcastPayload,
  type CoopBossFinishedBroadcastPayload,
  type CoopBossParticipantDto,
  type CoopBossRewardAvailableBroadcastPayload,
  type CoopBossRewardClaimDto,
  type CoopBossRewardPreview,
  type CoopBossRunDetailResponse,
  type CoopBossRunDto,
  type CoopBossRunListResponse,
  type CoopBossRunUpdatedBroadcastPayload,
  type CoopBossStatus,
  type MyCoopBossRunResponse,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CoopRewardCapService } from '../coop-reward-cap/coop-reward-cap.service';

/**
 * Phase 20.2 — Co-op Boss / World Boss Party Contribution.
 *
 * `CoopBossService` quản lý lifecycle co-op boss run + contribution
 * tracking + tiered reward claim. Tách rõ semantics khỏi:
 *   - `BossService` (Phase 7 / 12.6): global `WorldBoss` cross-party
 *     ranking theo `BossDamage`. Cohabit — `CoopBossRun.worldBossEventId`
 *     optional link tới `WorldBoss.id`.
 *   - `PartyDungeonService` (Phase 20.1): co-op dungeon room/run với
 *     reward split đều cho participant. Khác `CoopBoss`: foundation
 *     20.2 dùng contribution-tiered reward (NONE/LOW/NORMAL/HIGH/MVP).
 *
 * Hard invariants (test-enforced):
 *   1. Một party tại 1 thời điểm chỉ có 1 active run
 *      (`COOP_BOSS_LIMITS.maxActiveRunPerParty=1`). Service
 *      `assertNoActiveRun` check trong `createRun` tx.
 *   2. Chỉ leader hiện tại của party (qua membership) được tạo /
 *      finish / cancel run.
 *   3. Chỉ active member của cùng party mới được join / record
 *      contribution. Người ngoài → `NOT_PARTY_MEMBER` → 403/404
 *      mask ở controller.
 *   4. `recordContribution` cộng dồn `CoopBossContribution` row
 *      duy nhất per `(runId, participantId)` (UNIQUE constraint).
 *      Server clamp `damageDone` / `supportScore` / `survivalSeconds`
 *      theo `COOP_BOSS_LIMITS`. Vượt cap → clamp + ghi warning
 *      log (best-effort anomaly).
 *   5. Run chỉ resolve 1 lần (`finishedAt` set → không re-finish).
 *      Status `CLEARED` / `FAILED` / `CANCELED` đều terminal.
 *   6. Reward claim row chỉ tạo cho participant đạt
 *      `eligibleForReward=true` + tier ≠ `NONE`. Tier `NONE` không
 *      claim row → caller gặp `REWARD_NOT_FOUND`.
 *   7. Reward claim idempotent qua UNIQUE `(runId, userId)` +
 *      `(runId, characterId)` + CAS guard `status='PENDING'` →
 *      `'CLAIMED'`. 2 concurrent claim → đúng 1 winner ghi ledger.
 *   8. Non-participant không record contribution / claim được.
 *
 * Foundation mode (Phase 20.2):
 *   - Server-side combat engine chưa wire — client tự self-report
 *     `damageDone` / `supportScore` / `survivalSeconds` qua
 *     `recordContribution`. Server CLAMP hard cap (anti-cheat) +
 *     ghi anomaly. Phase 20.3+ sẽ wire server-side boss simulation
 *     để damage tuyệt đối.
 *   - Reward = deterministic theo tier (xem
 *     `computeCoopBossRewardTier`). KHÔNG share pool / KHÔNG bidding.
 *   - Ledger reason = `COOP_BOSS_REWARD`. Refs:
 *     `refType='CoopBossRewardClaim'` + `refId=claim.id`.
 */

export type CoopBossErrorCode =
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'INVALID_INPUT'
  | 'INVALID_BOSS_KEY'
  | 'NOT_IN_PARTY'
  | 'NOT_PARTY_LEADER'
  | 'NOT_PARTY_MEMBER'
  | 'RUN_ALREADY_EXISTS'
  | 'RUN_NOT_LOBBY'
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_ACTIVE'
  | 'RUN_ALREADY_FINISHED'
  | 'PARTICIPANT_NOT_FOUND'
  | 'PARTICIPANT_LEFT'
  | 'NOT_ENOUGH_MEMBERS'
  | 'CONTRIBUTION_WINDOW_CLOSED'
  | 'REWARD_NOT_FOUND'
  | 'REWARD_NOT_ELIGIBLE'
  | 'REWARD_ALREADY_CLAIMED'
  | 'RUN_NOT_FINISHED'
  | 'NO_CHARACTER'
  // Phase 20.3 — Co-op reward cap gate. Member chạm daily/weekly cap
  // → `claimReward` reject. Controller map về 409 Conflict.
  | 'DAILY_CAP_REACHED'
  | 'WEEKLY_CAP_REACHED';

export class CoopBossError extends Error {
  constructor(public readonly code: CoopBossErrorCode) {
    super(code);
  }
}

@Injectable()
export class CoopBossService {
  private readonly logger = new Logger(CoopBossService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    @Optional()
    @Inject(RealtimeService)
    private readonly realtime: RealtimeService | null = null,
    // Phase 20.3 — optional dependency. DI wire qua
    // `CoopBossModule` import `CoopRewardCapModule`. Test có thể
    // pass `null` để giữ behaviour cũ (cap=off / weekly record=off).
    @Optional()
    @Inject(CoopRewardCapService)
    private readonly coopRewardCap: CoopRewardCapService | null = null,
  ) {}

  // ---------------------------------------------------------------------------
  // Internal helpers — membership + DTO mapping
  // ---------------------------------------------------------------------------

  /**
   * Trả về active membership của user trong party hiện tại + flag
   * leader. Null = user không ở party active nào. Mirror logic
   * `PartyDungeonService.getActiveMembership`.
   */
  private async getActiveMembership(userId: string): Promise<{
    partyId: string;
    leaderUserId: string;
    isLeader: boolean;
  } | null> {
    const m = await this.prisma.partyMember.findFirst({
      where: { userId, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });
    if (!m) return null;
    const party = await this.prisma.party.findUnique({
      where: { id: m.partyId },
      select: { id: true, leaderUserId: true, status: true },
    });
    if (!party || party.status !== PrismaPartyStatus.ACTIVE) return null;
    return {
      partyId: party.id,
      leaderUserId: party.leaderUserId,
      isLeader: party.leaderUserId === userId,
    };
  }

  /**
   * Pick first character của user. Phase 6 single-character per user;
   * foundation 20.2 dùng pattern này để tương thích solo character
   * trước khi multi-character.
   */
  private async pickCharacterIdForUser(userId: string): Promise<string | null> {
    const ch = await this.prisma.character.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return ch?.id ?? null;
  }

  private toRunDto(r: {
    id: string;
    bossKey: string;
    partyId: string | null;
    worldBossEventId: string | null;
    status: PrismaCoopBossStatus;
    startedAt: Date;
    finishedAt: Date | null;
    resultSummaryJson: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): CoopBossRunDto {
    return {
      id: r.id,
      bossKey: r.bossKey,
      partyId: r.partyId,
      worldBossEventId: r.worldBossEventId,
      status: r.status as CoopBossStatus,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      resultSummaryJson:
        (r.resultSummaryJson as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toParticipantDto(
    p: {
      id: string;
      runId: string;
      userId: string;
      characterId: string;
      partyId: string | null;
      joinedAt: Date;
      leftAt: Date | null;
      eligibleForReward: boolean;
      finalContributionScore: number | null;
    },
    characterName: string | null = null,
  ): CoopBossParticipantDto {
    return {
      id: p.id,
      runId: p.runId,
      userId: p.userId,
      characterId: p.characterId,
      partyId: p.partyId,
      characterName,
      joinedAt: p.joinedAt.toISOString(),
      leftAt: p.leftAt?.toISOString() ?? null,
      eligibleForReward: p.eligibleForReward,
      finalContributionScore: p.finalContributionScore,
    };
  }

  private toContributionDto(c: {
    id: string;
    runId: string;
    participantId: string;
    damageDone: bigint;
    supportScore: number;
    survivalSeconds: number;
    actionCount: number;
    contributionScore: number;
    createdAt: Date;
    updatedAt: Date;
  }): CoopBossContributionDto {
    return {
      id: c.id,
      runId: c.runId,
      participantId: c.participantId,
      damageDone: c.damageDone.toString(),
      supportScore: c.supportScore,
      survivalSeconds: c.survivalSeconds,
      actionCount: c.actionCount,
      contributionScore: c.contributionScore,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private toRewardClaimDto(c: {
    id: string;
    runId: string;
    userId: string;
    characterId: string;
    status: PrismaCoopBossRewardClaimStatus;
    rewardTier: PrismaCoopBossContributionTier;
    rewardJson: Prisma.JsonValue;
    claimedAt: Date | null;
    createdAt: Date;
  }): CoopBossRewardClaimDto {
    return {
      id: c.id,
      runId: c.runId,
      userId: c.userId,
      characterId: c.characterId,
      status: c.status as CoopBossRewardClaimDto['status'],
      rewardTier: c.rewardTier as CoopBossContributionTier,
      rewardJson:
        (c.rewardJson as unknown as CoopBossRewardPreview) ??
        ({ tier: 'NONE' } as CoopBossRewardPreview),
      claimedAt: c.claimedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Trả về current run + participant snapshot + caller's contribution
   * + caller's reward (nếu có). Caller không thuộc party → empty
   * response. Caller thuộc party nhưng chưa join run → empty
   * contribution / reward.
   */
  async getMyRun(userId: string): Promise<MyCoopBossRunResponse> {
    const m = await this.getActiveMembership(userId);
    if (!m) {
      return {
        run: null,
        participants: [],
        myContribution: null,
        myReward: null,
        myRewardPreview: null,
      };
    }

    const run = await this.prisma.coopBossRun.findFirst({
      where: {
        partyId: m.partyId,
        status: {
          notIn: [
            PrismaCoopBossStatus.CLEARED,
            PrismaCoopBossStatus.FAILED,
            PrismaCoopBossStatus.CANCELED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) {
      return {
        run: null,
        participants: [],
        myContribution: null,
        myReward: null,
        myRewardPreview: null,
      };
    }

    const participants = await this.listParticipantsForRun(run.id);
    const myPart = await this.prisma.coopBossParticipant.findUnique({
      where: { runId_userId: { runId: run.id, userId } },
    });
    let myContribution: CoopBossContributionDto | null = null;
    let myRewardPreview: CoopBossRewardPreview | null = null;
    if (myPart) {
      const contrib = await this.prisma.coopBossContribution.findUnique({
        where: {
          runId_participantId: { runId: run.id, participantId: myPart.id },
        },
      });
      if (contrib) {
        myContribution = this.toContributionDto(contrib);
        const tier = classifyContributionTier({
          contributionScore: contrib.contributionScore,
          eligibleForReward: myPart.eligibleForReward,
          isMvpCandidate: false,
        });
        myRewardPreview = computeCoopBossRewardTier({ tier });
      }
    }
    const myReward = await this.prisma.coopBossRewardClaim.findUnique({
      where: { runId_userId: { runId: run.id, userId } },
    });

    return {
      run: this.toRunDto(run),
      participants,
      myContribution,
      myReward: myReward ? this.toRewardClaimDto(myReward) : null,
      myRewardPreview,
    };
  }

  async listParticipantsForRun(
    runId: string,
  ): Promise<CoopBossParticipantDto[]> {
    const rows = await this.prisma.coopBossParticipant.findMany({
      where: { runId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });
    if (rows.length === 0) return [];
    const charIds = rows.map((r) => r.characterId);
    const chars = await this.prisma.character.findMany({
      where: { id: { in: charIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(chars.map((c) => [c.id, c.name]));
    return rows.map((r) =>
      this.toParticipantDto(r, nameById.get(r.characterId) ?? null),
    );
  }

  /**
   * Run detail cho participant. Reject:
   *   - Run không tồn tại → `RUN_NOT_FOUND`.
   *   - Caller không phải participant của run → `NOT_PARTY_MEMBER`
   *     (404 mask).
   */
  async getRunSummary(input: {
    userId: string;
    runId: string;
  }): Promise<CoopBossRunDetailResponse> {
    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) throw new CoopBossError('RUN_NOT_FOUND');

    const part = await this.prisma.coopBossParticipant.findUnique({
      where: {
        runId_userId: { runId: run.id, userId: input.userId },
      },
    });
    if (!part) throw new CoopBossError('NOT_PARTY_MEMBER');

    const participants = await this.listParticipantsForRun(run.id);
    const contribsRaw = await this.prisma.coopBossContribution.findMany({
      where: { runId: run.id },
      orderBy: { contributionScore: 'desc' },
    });
    const rewardsRaw = await this.prisma.coopBossRewardClaim.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      run: this.toRunDto(run),
      participants,
      contributions: contribsRaw.map((c) => this.toContributionDto(c)),
      rewards: rewardsRaw.map((r) => this.toRewardClaimDto(r)),
    };
  }

  /**
   * List runs của user (mọi character). Order desc theo `createdAt`.
   * `limit` ≤ 50, default 20.
   */
  async listMyBossRuns(input: {
    userId: string;
    limit?: number;
  }): Promise<CoopBossRunListResponse> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const parts = await this.prisma.coopBossParticipant.findMany({
      where: { userId: input.userId },
      orderBy: { joinedAt: 'desc' },
      take: limit,
      select: { runId: true },
    });
    const runIds = Array.from(new Set(parts.map((p) => p.runId)));
    if (runIds.length === 0) return { runs: [] };
    const runs = await this.prisma.coopBossRun.findMany({
      where: { id: { in: runIds } },
      orderBy: { createdAt: 'desc' },
    });
    return { runs: runs.map((r) => this.toRunDto(r)) };
  }

  // ---------------------------------------------------------------------------
  // Admin reads
  // ---------------------------------------------------------------------------

  async adminListRuns(input: {
    status?: CoopBossStatus | null;
    bossKey?: string | null;
    partyId?: string | null;
    limit?: number;
  }): Promise<CoopBossRunListResponse> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const where: Prisma.CoopBossRunWhereInput = {};
    if (input.status) where.status = input.status as PrismaCoopBossStatus;
    if (input.bossKey) where.bossKey = input.bossKey;
    if (input.partyId) where.partyId = input.partyId;
    const rows = await this.prisma.coopBossRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { runs: rows.map((r) => this.toRunDto(r)) };
  }

  async adminGetRunDetail(runId: string): Promise<CoopBossRunDetailResponse> {
    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new CoopBossError('RUN_NOT_FOUND');
    const participants = await this.listParticipantsForRun(run.id);
    const contribsRaw = await this.prisma.coopBossContribution.findMany({
      where: { runId: run.id },
      orderBy: { contributionScore: 'desc' },
    });
    const rewardsRaw = await this.prisma.coopBossRewardClaim.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      run: this.toRunDto(run),
      participants,
      contributions: contribsRaw.map((c) => this.toContributionDto(c)),
      rewards: rewardsRaw.map((r) => this.toRewardClaimDto(r)),
    };
  }

  /**
   * Admin recompute contribution score cho 1 run (idempotent).
   * Server quét `CoopBossContribution` rows + tính lại
   * `contributionScore` qua `computeContributionScore`. KHÔNG mutate
   * tier / reward claim row đã tạo (giữ deterministic snapshot tại
   * finishRun). Phase 20.3+ có thể cho phép admin recompute reward
   * claim.
   */
  async adminRecomputeContribution(runId: string): Promise<{
    updated: number;
  }> {
    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new CoopBossError('RUN_NOT_FOUND');
    const contribs = await this.prisma.coopBossContribution.findMany({
      where: { runId },
    });
    let updated = 0;
    for (const c of contribs) {
      const score = computeContributionScore({
        damageDone: c.damageDone,
        supportScore: c.supportScore,
        survivalSeconds: c.survivalSeconds,
      });
      if (score !== c.contributionScore) {
        await this.prisma.coopBossContribution.update({
          where: { id: c.id },
          data: { contributionScore: score },
        });
        updated += 1;
      }
    }
    return { updated };
  }

  // ---------------------------------------------------------------------------
  // Mutations — run lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Leader tạo run cho boss `bossKey`. Reject nếu:
   *   - Caller không ở party → `NOT_IN_PARTY`.
   *   - Caller không phải leader → `NOT_PARTY_LEADER`.
   *   - Party đã có active run → `RUN_ALREADY_EXISTS`.
   *   - `bossKey` không hợp lệ (không trong catalog `BOSSES`) →
   *     `INVALID_BOSS_KEY`.
   *
   * Auto-join leader làm participant đầu tiên. Status mặc định
   * `LOBBY`; foundation phase chấp nhận leader gọi join + start
   * trong cùng tx (callsite quyết định).
   */
  async createRun(input: {
    leaderUserId: string;
    bossKey: string;
    worldBossEventId?: string | null;
  }): Promise<MyCoopBossRunResponse> {
    if (!bossByKey(input.bossKey)) {
      throw new CoopBossError('INVALID_BOSS_KEY');
    }

    const m = await this.getActiveMembership(input.leaderUserId);
    if (!m) throw new CoopBossError('NOT_IN_PARTY');
    if (!m.isLeader) throw new CoopBossError('NOT_PARTY_LEADER');

    const leaderCharId = await this.pickCharacterIdForUser(input.leaderUserId);
    if (!leaderCharId) throw new CoopBossError('NO_CHARACTER');

    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.coopBossRun.findFirst({
        where: {
          partyId: m.partyId,
          status: {
            notIn: [
              PrismaCoopBossStatus.CLEARED,
              PrismaCoopBossStatus.FAILED,
              PrismaCoopBossStatus.CANCELED,
            ],
          },
        },
      });
      if (existing) {
        throw new CoopBossError('RUN_ALREADY_EXISTS');
      }
      const run = await tx.coopBossRun.create({
        data: {
          bossKey: input.bossKey,
          partyId: m.partyId,
          worldBossEventId: input.worldBossEventId ?? null,
          status: PrismaCoopBossStatus.LOBBY,
        },
      });
      await tx.coopBossParticipant.create({
        data: {
          runId: run.id,
          userId: input.leaderUserId,
          characterId: leaderCharId,
          partyId: m.partyId,
        },
      });
      return run;
    });

    void this.emitRunUpdated(created.id);
    return this.getMyRun(input.leaderUserId);
  }

  /**
   * Member của party hiện tại join run. Reject:
   *   - Caller không ở party → `NOT_IN_PARTY`.
   *   - Run không tồn tại → `RUN_NOT_FOUND`.
   *   - Caller không cùng party với run → `NOT_PARTY_MEMBER`.
   *   - Run không LOBBY / IN_PROGRESS → `RUN_NOT_ACTIVE`.
   *   - Đã max → `RUN_NOT_LOBBY`.
   *
   * Idempotent: nếu đã active participant, trả về view không thay đổi.
   * Foundation cho phép join cả LOBBY và IN_PROGRESS (mid-run join
   * — contribution chỉ tính từ lúc join trở đi).
   */
  async joinRun(input: {
    userId: string;
    runId: string;
  }): Promise<MyCoopBossRunResponse> {
    const m = await this.getActiveMembership(input.userId);
    if (!m) throw new CoopBossError('NOT_IN_PARTY');

    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) throw new CoopBossError('RUN_NOT_FOUND');
    if (run.partyId !== m.partyId) {
      throw new CoopBossError('NOT_PARTY_MEMBER');
    }
    if (
      run.status !== PrismaCoopBossStatus.LOBBY &&
      run.status !== PrismaCoopBossStatus.IN_PROGRESS
    ) {
      throw new CoopBossError('RUN_NOT_ACTIVE');
    }

    const charId = await this.pickCharacterIdForUser(input.userId);
    if (!charId) throw new CoopBossError('NO_CHARACTER');

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.coopBossParticipant.findUnique({
        where: {
          runId_userId: { runId: run.id, userId: input.userId },
        },
      });
      if (existing) {
        // Idempotent: nếu left, restore.
        if (existing.leftAt !== null) {
          await tx.coopBossParticipant.update({
            where: { id: existing.id },
            data: { leftAt: null, characterId: charId },
          });
        }
        return;
      }
      // Cap: maxMembers active.
      const activeCount = await tx.coopBossParticipant.count({
        where: { runId: run.id, leftAt: null },
      });
      if (activeCount >= COOP_BOSS_LIMITS.maxMembers) {
        throw new CoopBossError('RUN_NOT_LOBBY');
      }
      await tx.coopBossParticipant.create({
        data: {
          runId: run.id,
          userId: input.userId,
          characterId: charId,
          partyId: m.partyId,
        },
      });
    });

    void this.emitRunUpdated(run.id);
    return this.getMyRun(input.userId);
  }

  /**
   * Member rời run trước khi finish. Idempotent: nếu đã left, no-op.
   * Set `leftAt=now`; finishRun sau đó sẽ `eligibleForReward=false`
   * nếu survival < minSurvivalSeconds.
   */
  async leaveRun(input: {
    userId: string;
    runId: string;
  }): Promise<MyCoopBossRunResponse> {
    const m = await this.getActiveMembership(input.userId);
    if (!m) throw new CoopBossError('NOT_IN_PARTY');

    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) throw new CoopBossError('RUN_NOT_FOUND');
    if (run.partyId !== m.partyId) {
      throw new CoopBossError('NOT_PARTY_MEMBER');
    }

    const part = await this.prisma.coopBossParticipant.findUnique({
      where: {
        runId_userId: { runId: run.id, userId: input.userId },
      },
    });
    if (!part) throw new CoopBossError('PARTICIPANT_NOT_FOUND');
    if (part.leftAt === null) {
      await this.prisma.coopBossParticipant.update({
        where: { id: part.id },
        data: { leftAt: new Date() },
      });
      void this.emitRunUpdated(run.id);
    }
    return this.getMyRun(input.userId);
  }

  /**
   * Member ghi contribution. Reject:
   *   - Run không tồn tại / không ACTIVE → `RUN_NOT_FOUND` /
   *     `RUN_NOT_ACTIVE`.
   *   - Caller không phải participant active của run →
   *     `PARTICIPANT_NOT_FOUND` (404 mask).
   *   - Window đóng (now > startedAt + contributionWindowSeconds) →
   *     `CONTRIBUTION_WINDOW_CLOSED`.
   *
   * Clamp + cộng dồn vào `CoopBossContribution` row UNIQUE
   * `(runId, participantId)`. Anomaly raw input vượt cap → log
   * warning (best-effort). Recompute `contributionScore` mỗi lần
   * cộng dồn (deterministic via `computeContributionScore`).
   *
   * Idempotent semantics: KHÔNG idempotent — mỗi call cộng dồn
   * delta. Rate-limit `COOP_BOSS_CONTRIBUTION` ở controller bảo
   * vệ spam fake-damage.
   */
  async recordContribution(input: {
    userId: string;
    runId: string;
    damageDone: number | bigint;
    supportScore: number;
    survivalSeconds: number;
  }): Promise<CoopBossContributionDto> {
    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) throw new CoopBossError('RUN_NOT_FOUND');
    if (
      run.status !== PrismaCoopBossStatus.LOBBY &&
      run.status !== PrismaCoopBossStatus.IN_PROGRESS
    ) {
      throw new CoopBossError('RUN_NOT_ACTIVE');
    }

    // Window check.
    const ageSec = (Date.now() - run.startedAt.getTime()) / 1000;
    if (ageSec > COOP_BOSS_LIMITS.contributionWindowSeconds) {
      throw new CoopBossError('CONTRIBUTION_WINDOW_CLOSED');
    }

    const part = await this.prisma.coopBossParticipant.findUnique({
      where: {
        runId_userId: { runId: run.id, userId: input.userId },
      },
    });
    if (!part) throw new CoopBossError('PARTICIPANT_NOT_FOUND');
    if (part.leftAt !== null) {
      throw new CoopBossError('PARTICIPANT_LEFT');
    }

    // Clamp + anomaly log (best-effort, non-blocking).
    const { clamped, anomaly } = clampContributionInput({
      damageDone: input.damageDone,
      supportScore: input.supportScore,
      survivalSeconds: input.survivalSeconds,
    });
    if (anomaly) {
      this.logger.warn(
        `[coop-boss:anomaly] runId=${run.id} userId=${input.userId} clamped contribution input`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Auto-promote LOBBY → IN_PROGRESS khi có contribution đầu tiên
      // > 0 (foundation: simple start trigger).
      if (
        run.status === PrismaCoopBossStatus.LOBBY &&
        (clamped.damageDone > 0n || clamped.supportScore > 0)
      ) {
        await tx.coopBossRun.update({
          where: { id: run.id },
          data: {
            status: PrismaCoopBossStatus.IN_PROGRESS,
            startedAt: new Date(),
          },
        });
      }

      const existing = await tx.coopBossContribution.findUnique({
        where: {
          runId_participantId: {
            runId: run.id,
            participantId: part.id,
          },
        },
      });

      const nextDamage =
        (existing?.damageDone ?? 0n) + clamped.damageDone;
      const nextSupport = Math.min(
        COOP_BOSS_LIMITS.maxActionCountPerRun *
          COOP_BOSS_LIMITS.maxSupportPerContribution,
        (existing?.supportScore ?? 0) + clamped.supportScore,
      );
      const nextSurvival = Math.min(
        COOP_BOSS_LIMITS.contributionWindowSeconds,
        Math.max(
          existing?.survivalSeconds ?? 0,
          clamped.survivalSeconds,
        ),
      );
      const nextActionCount = Math.min(
        COOP_BOSS_LIMITS.maxActionCountPerRun,
        (existing?.actionCount ?? 0) + 1,
      );
      const nextScore = computeContributionScore({
        damageDone: nextDamage,
        supportScore: nextSupport,
        survivalSeconds: nextSurvival,
      });

      if (existing) {
        return tx.coopBossContribution.update({
          where: { id: existing.id },
          data: {
            damageDone: nextDamage,
            supportScore: nextSupport,
            survivalSeconds: nextSurvival,
            actionCount: nextActionCount,
            contributionScore: nextScore,
          },
        });
      }
      return tx.coopBossContribution.create({
        data: {
          runId: run.id,
          participantId: part.id,
          damageDone: nextDamage,
          supportScore: nextSupport,
          survivalSeconds: nextSurvival,
          actionCount: nextActionCount,
          contributionScore: nextScore,
        },
      });
    });

    void this.emitContributionUpdated({
      runId: run.id,
      participantId: part.id,
      userId: input.userId,
      contributionScore: updated.contributionScore,
    });

    return this.toContributionDto(updated);
  }

  /**
   * Leader finish run với result CLEARED hoặc FAILED. Reject:
   *   - Caller không leader → `NOT_PARTY_LEADER`.
   *   - Run đã terminal → `RUN_ALREADY_FINISHED`.
   *   - Run không ACTIVE → `RUN_NOT_ACTIVE`.
   *
   * Tạo `CoopBossRewardClaim` row PENDING cho participant đạt tier ≠
   * NONE (chỉ nếu result=CLEARED). MVP = top1 contribution ≥
   * minMvpScore. Snapshot tier + finalContributionScore +
   * eligibleForReward về participant row.
   */
  async finishRun(input: {
    leaderUserId: string;
    runId: string;
    result: 'CLEARED' | 'FAILED';
  }): Promise<MyCoopBossRunResponse> {
    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) throw new CoopBossError('RUN_NOT_FOUND');
    if (
      run.status === PrismaCoopBossStatus.CLEARED ||
      run.status === PrismaCoopBossStatus.FAILED ||
      run.status === PrismaCoopBossStatus.CANCELED
    ) {
      throw new CoopBossError('RUN_ALREADY_FINISHED');
    }

    const m = await this.getActiveMembership(input.leaderUserId);
    if (!m || m.partyId !== run.partyId) {
      throw new CoopBossError('NOT_PARTY_MEMBER');
    }
    if (!m.isLeader) throw new CoopBossError('NOT_PARTY_LEADER');

    const result = await this.prisma.$transaction(async (tx) => {
      const participants = await tx.coopBossParticipant.findMany({
        where: { runId: run.id },
        orderBy: { joinedAt: 'asc' },
      });
      const contribs = await tx.coopBossContribution.findMany({
        where: { runId: run.id },
      });
      const contribByPart = new Map(contribs.map((c) => [c.participantId, c]));

      // Determine MVP candidate: top1 score ≥ minMvpScore, eligible.
      let mvpUserId: string | null = null;
      if (input.result === 'CLEARED') {
        let bestScore = COOP_BOSS_LIMITS.minMvpScore - 1;
        for (const p of participants) {
          if (p.leftAt !== null) continue;
          const c = contribByPart.get(p.id);
          if (!c) continue;
          const survivalOk =
            c.survivalSeconds >= COOP_BOSS_LIMITS.minSurvivalSeconds;
          if (!survivalOk) continue;
          if (c.contributionScore > bestScore) {
            bestScore = c.contributionScore;
            mvpUserId = p.userId;
          }
        }
      }

      // Update each participant + create reward claim if CLEARED + eligible.
      // Phase 20.3 — apply leech-risk downgrade per participant trước khi
      // create reward claim. Leech HIGH → tier bị hạ; tính anomaly write
      // best-effort outside tx (xem `leechAudits` push dưới).
      const claimRows: Array<{
        userId: string;
        characterId: string;
        id: string;
        tier: CoopBossContributionTier;
      }> = [];
      const leechAudits: Array<{
        userId: string;
        characterId: string;
        contributionScore: number;
        survivalSeconds: number;
        actionCount: number;
        originalTier: CoopBossContributionTier;
      }> = [];
      const weeklyRecords: Array<{
        userId: string;
        characterId: string;
        bossContributionScore: number;
        isMvp: boolean;
      }> = [];
      for (const p of participants) {
        const c = contribByPart.get(p.id);
        const score = c?.contributionScore ?? 0;
        const survivalOk =
          (c?.survivalSeconds ?? 0) >= COOP_BOSS_LIMITS.minSurvivalSeconds;
        const stillIn = p.leftAt === null;
        const eligible =
          input.result === 'CLEARED' && stillIn && survivalOk;

        await tx.coopBossParticipant.update({
          where: { id: p.id },
          data: {
            eligibleForReward: eligible,
            finalContributionScore: score,
          },
        });

        if (!eligible) continue;
        const originalTier = classifyContributionTier({
          contributionScore: score,
          eligibleForReward: eligible,
          isMvpCandidate: mvpUserId === p.userId,
        });
        if (originalTier === 'NONE') continue;

        // Phase 20.3 — leech downgrade trước khi snapshot reward tier.
        // Pure helper inline trong tx; anomaly write đẩy ra ngoài tx
        // (best-effort, không ảnh hưởng claim creation).
        const leechRisk = classifyCoopLeechRisk({
          contributionScore: score,
          survivalSeconds: c?.survivalSeconds ?? 0,
          actionCount: c?.actionCount ?? 0,
        });
        const tier = applyLeechRiskDowngrade<CoopBossContributionTier>({
          tier: originalTier,
          leechRisk,
        });
        leechAudits.push({
          userId: p.userId,
          characterId: p.characterId,
          contributionScore: score,
          survivalSeconds: c?.survivalSeconds ?? 0,
          actionCount: c?.actionCount ?? 0,
          originalTier,
        });
        if (tier === 'NONE') continue;
        weeklyRecords.push({
          userId: p.userId,
          characterId: p.characterId,
          bossContributionScore: score,
          isMvp: mvpUserId === p.userId,
        });
        const reward = computeCoopBossRewardTier({ tier });
        const claim = await tx.coopBossRewardClaim.create({
          data: {
            runId: run.id,
            userId: p.userId,
            characterId: p.characterId,
            status: PrismaCoopBossRewardClaimStatus.PENDING,
            rewardTier: tier as PrismaCoopBossContributionTier,
            rewardJson: reward as unknown as Prisma.InputJsonValue,
          },
        });
        claimRows.push({
          userId: p.userId,
          characterId: p.characterId,
          id: claim.id,
          tier,
        });
      }

      const summary = {
        result: input.result,
        mvpUserId,
        participantCount: participants.length,
        contributionRows: contribs.map((c) => ({
          participantId: c.participantId,
          score: c.contributionScore,
        })),
      };

      await tx.coopBossRun.update({
        where: { id: run.id },
        data: {
          status:
            input.result === 'CLEARED'
              ? PrismaCoopBossStatus.CLEARED
              : PrismaCoopBossStatus.FAILED,
          finishedAt: new Date(),
          resultSummaryJson: summary as Prisma.InputJsonValue,
        },
      });

      return { claimRows, mvpUserId, leechAudits, weeklyRecords };
    });

    // Phase 20.3 — best-effort write leech anomaly + weekly contribution
    // outside tx. Không ảnh hưởng claim creation; service optional.
    if (this.coopRewardCap) {
      for (const a of result.leechAudits) {
        try {
          await this.coopRewardCap.classifyAndAuditLeechRisk({
            userId: a.userId,
            characterId: a.characterId,
            contributionScore: a.contributionScore,
            survivalSeconds: a.survivalSeconds,
            actionCount: a.actionCount,
            originalTier: a.originalTier,
            source: 'COOP_BOSS',
          });
        } catch (e) {
          this.logger.debug(
            `coop-boss leech audit skip: ${(e as Error).message}`,
          );
        }
      }
      for (const w of result.weeklyRecords) {
        try {
          await this.coopRewardCap.recordWeeklyContribution({
            userId: w.userId,
            characterId: w.characterId,
            bossContributionScore: w.bossContributionScore,
            dungeonContributionScore: 0,
            isMvp: w.isMvp,
          });
        } catch (e) {
          this.logger.debug(
            `coop-boss weekly record skip: ${(e as Error).message}`,
          );
        }
      }
    }

    void this.emitFinished({
      runId: run.id,
      partyId: run.partyId,
      status: input.result,
      mvpUserId: result.mvpUserId,
    });
    void this.emitRunUpdated(run.id);
    for (const c of result.claimRows) {
      void this.emitRewardAvailable({
        runId: run.id,
        userId: c.userId,
        rewardClaimId: c.id,
        rewardTier: c.tier,
      });
    }

    return this.getMyRun(input.leaderUserId);
  }

  /** Alias finishRun với result FAILED — convenience cho controller / test. */
  async failRun(input: {
    leaderUserId: string;
    runId: string;
  }): Promise<MyCoopBossRunResponse> {
    return this.finishRun({ ...input, result: 'FAILED' });
  }

  /**
   * Leader cancel run khi LOBBY. Reject nếu đã IN_PROGRESS / terminal.
   */
  async cancelRun(input: {
    leaderUserId: string;
    runId: string;
  }): Promise<MyCoopBossRunResponse> {
    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) throw new CoopBossError('RUN_NOT_FOUND');
    if (run.status !== PrismaCoopBossStatus.LOBBY) {
      throw new CoopBossError('RUN_NOT_LOBBY');
    }
    const m = await this.getActiveMembership(input.leaderUserId);
    if (!m || m.partyId !== run.partyId) {
      throw new CoopBossError('NOT_PARTY_MEMBER');
    }
    if (!m.isLeader) throw new CoopBossError('NOT_PARTY_LEADER');
    await this.prisma.coopBossRun.update({
      where: { id: run.id },
      data: {
        status: PrismaCoopBossStatus.CANCELED,
        finishedAt: new Date(),
      },
    });
    void this.emitRunUpdated(run.id);
    return this.getMyRun(input.leaderUserId);
  }

  // ---------------------------------------------------------------------------
  // Reward preview + claim
  // ---------------------------------------------------------------------------

  /**
   * Preview reward cho caller tại run hiện tại. Trả tier dự kiến
   * dựa trên contribution score hiện thời. Pure, không mutate.
   * Caller không phải participant → null preview.
   */
  async previewReward(input: {
    userId: string;
    runId: string;
  }): Promise<CoopBossRewardPreview | null> {
    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) return null;
    const part = await this.prisma.coopBossParticipant.findUnique({
      where: {
        runId_userId: { runId: run.id, userId: input.userId },
      },
    });
    if (!part) return null;
    const contrib = await this.prisma.coopBossContribution.findUnique({
      where: {
        runId_participantId: { runId: run.id, participantId: part.id },
      },
    });
    const score = contrib?.contributionScore ?? 0;
    const survivalOk =
      (contrib?.survivalSeconds ?? 0) >= COOP_BOSS_LIMITS.minSurvivalSeconds;
    const stillIn = part.leftAt === null;
    const tier = classifyContributionTier({
      contributionScore: score,
      eligibleForReward: stillIn && survivalOk,
      isMvpCandidate: false,
    });
    return computeCoopBossRewardTier({ tier });
  }

  /**
   * Member claim reward sau khi run CLEARED. Atomic CAS + ledger
   * grant qua `CurrencyService.applyTx` + `InventoryService.grantTx`
   * (reason='COOP_BOSS_REWARD').
   */
  async claimReward(input: {
    userId: string;
    runId: string;
  }): Promise<CoopBossRewardClaimDto> {
    const run = await this.prisma.coopBossRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) throw new CoopBossError('RUN_NOT_FOUND');
    if (run.status !== PrismaCoopBossStatus.CLEARED) {
      throw new CoopBossError('RUN_NOT_FINISHED');
    }

    const claim = await this.prisma.coopBossRewardClaim.findUnique({
      where: {
        runId_userId: { runId: input.runId, userId: input.userId },
      },
    });
    if (!claim) throw new CoopBossError('REWARD_NOT_FOUND');

    const part = await this.prisma.coopBossParticipant.findUnique({
      where: {
        runId_userId: { runId: input.runId, userId: input.userId },
      },
    });
    const gate = canClaimCoopBossReward({
      runStatus: run.status as CoopBossStatus,
      eligibleForReward: part?.eligibleForReward ?? false,
      rewardTier: claim.rewardTier as CoopBossContributionTier,
      rewardStatus: claim.status as CoopBossRewardClaimDto['status'],
    });
    if (!gate.ok) {
      if (gate.code === 'ALREADY_CLAIMED') {
        throw new CoopBossError('REWARD_ALREADY_CLAIMED');
      }
      if (gate.code === 'RUN_NOT_FINISHED') {
        throw new CoopBossError('RUN_NOT_FINISHED');
      }
      throw new CoopBossError('REWARD_NOT_ELIGIBLE');
    }

    const reward =
      (claim.rewardJson as unknown as CoopBossRewardPreview) ?? {
        tier: 'NONE',
      };
    const refId = buildCoopBossRunRefId({
      runId: run.id,
      characterId: claim.characterId,
    });

    // Phase 20.3 — daily/weekly cap gate. Read snapshot trước tx;
    // nếu đã chạm cap thì reject claim + audit anomaly. Service
    // optional (test instantiate thẳng → `coopRewardCap=null`) → skip.
    if (this.coopRewardCap) {
      const cap = await this.coopRewardCap.checkDailyWeeklyCap({
        userId: input.userId,
        source: 'COOP_BOSS',
      });
      if (!cap.ok) {
        void this.coopRewardCap.auditCapBypassAttempt({
          userId: input.userId,
          characterId: claim.characterId,
          source: 'COOP_BOSS',
          code: cap.code ?? 'DAILY_CAP_REACHED',
          dailyClaims: cap.dailyClaims,
          weeklyClaims: cap.weeklyClaims,
        });
        throw new CoopBossError(
          cap.code === 'WEEKLY_CAP_REACHED'
            ? 'WEEKLY_CAP_REACHED'
            : 'DAILY_CAP_REACHED',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // CAS guard: chỉ winner mới flip PENDING → CLAIMED.
      const upd = await tx.coopBossRewardClaim.updateMany({
        where: {
          id: claim.id,
          status: PrismaCoopBossRewardClaimStatus.PENDING,
        },
        data: {
          status: PrismaCoopBossRewardClaimStatus.CLAIMED,
          claimedAt: new Date(),
        },
      });
      if (upd.count === 0) {
        throw new CoopBossError('REWARD_ALREADY_CLAIMED');
      }

      if (reward.linhThach && reward.linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId: claim.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(reward.linhThach),
          reason: 'COOP_BOSS_REWARD',
          refType: 'CoopBossRewardClaim',
          refId,
          actorUserId: claim.userId,
        });
      }
      if (reward.tienNgoc && reward.tienNgoc > 0) {
        await this.currency.applyTx(tx, {
          characterId: claim.characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(reward.tienNgoc),
          reason: 'COOP_BOSS_REWARD',
          refType: 'CoopBossRewardClaim',
          refId,
          actorUserId: claim.userId,
        });
      }

      if (reward.items && reward.items.length > 0) {
        await this.inventory.grantTx(
          tx,
          claim.characterId,
          reward.items.map((i) => ({ itemKey: i.itemKey, qty: i.qty })),
          {
            reason: 'COOP_BOSS_REWARD',
            refType: 'CoopBossRewardClaim',
            refId,
            actorUserId: claim.userId,
          },
        );
      }

      if (reward.exp && reward.exp > 0) {
        await tx.character.update({
          where: { id: claim.characterId },
          data: { exp: { increment: reward.exp } },
        });
      }

      // Phase 20.3 — increment cap counter trong cùng tx để rollback
      // nếu grant fail. Service optional; skip nếu DI null.
      if (this.coopRewardCap) {
        await this.coopRewardCap.incrementRewardCapCounterTx(tx, {
          userId: claim.userId,
          characterId: claim.characterId,
          source: 'COOP_BOSS',
          rewardValueApprox: BigInt(reward.linhThach ?? 0),
        });
      }
    });

    const updated = await this.prisma.coopBossRewardClaim.findUnique({
      where: { id: claim.id },
    });
    if (!updated) throw new CoopBossError('REWARD_NOT_FOUND');
    return this.toRewardClaimDto(updated);
  }

  // ---------------------------------------------------------------------------
  // Realtime helpers (best-effort)
  // ---------------------------------------------------------------------------

  private async emitRunUpdated(runId: string): Promise<void> {
    if (!this.realtime) return;
    try {
      const run = await this.prisma.coopBossRun.findUnique({
        where: { id: runId },
      });
      if (!run) return;
      const active = await this.prisma.coopBossParticipant.findMany({
        where: { runId, leftAt: null },
        select: { userId: true },
      });
      const payload: CoopBossRunUpdatedBroadcastPayload = {
        runId,
        partyId: run.partyId,
        bossKey: run.bossKey,
        status: run.status as CoopBossStatus,
        participantsCount: active.length,
      };
      for (const p of active) {
        this.realtime.emitToUser(p.userId, 'coop-boss:run-updated', payload);
      }
    } catch {
      /* best-effort */
    }
  }

  private async emitContributionUpdated(
    p: CoopBossContributionUpdatedBroadcastPayload,
  ): Promise<void> {
    if (!this.realtime) return;
    try {
      const active = await this.prisma.coopBossParticipant.findMany({
        where: { runId: p.runId, leftAt: null },
        select: { userId: true },
      });
      for (const a of active) {
        this.realtime.emitToUser(
          a.userId,
          'coop-boss:contribution-updated',
          p,
        );
      }
    } catch {
      /* best-effort */
    }
  }

  private async emitFinished(
    p: CoopBossFinishedBroadcastPayload,
  ): Promise<void> {
    if (!this.realtime) return;
    try {
      const all = await this.prisma.coopBossParticipant.findMany({
        where: { runId: p.runId },
        select: { userId: true },
      });
      for (const a of all) {
        this.realtime.emitToUser(a.userId, 'coop-boss:finished', p);
      }
    } catch {
      /* best-effort */
    }
  }

  private emitRewardAvailable(
    p: CoopBossRewardAvailableBroadcastPayload,
  ): void {
    if (!this.realtime) return;
    try {
      // Per-user only — không leak cross-party.
      this.realtime.emitToUser(p.userId, 'coop-boss:reward-available', p);
    } catch {
      /* best-effort */
    }
  }
}
