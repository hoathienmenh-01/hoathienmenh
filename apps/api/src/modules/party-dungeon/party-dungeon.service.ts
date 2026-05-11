import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CurrencyKind,
  PartyDungeonRewardClaimStatus as PrismaPartyDungeonRewardClaimStatus,
  PartyDungeonRoomStatus as PrismaPartyDungeonRoomStatus,
  PartyDungeonRunResult as PrismaPartyDungeonRunResult,
  PartyStatus as PrismaPartyStatus,
  Prisma,
} from '@prisma/client';
import {
  COOP_DUNGEON_LIMITS,
  canStartPartyDungeon,
  computePartyDungeonRewardSplit,
  dungeonByKey,
  type MyPartyDungeonRoomResponse,
  type PartyDungeonParticipantDto,
  type PartyDungeonRewardAvailableBroadcastPayload,
  type PartyDungeonRewardClaimDto,
  type PartyDungeonRewardPreview,
  type PartyDungeonRoomDto,
  type PartyDungeonRoomUpdatedBroadcastPayload,
  type PartyDungeonReadyUpdatedBroadcastPayload,
  type PartyDungeonStartedBroadcastPayload,
  type PartyDungeonCompletedBroadcastPayload,
  type PartyDungeonRunDto,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Phase 20.1 — Party Dungeon / Co-op PvE Foundation.
 *
 * `PartyDungeonService` quản lý lifecycle co-op room + run + reward
 * claim. Tách rõ semantics khỏi `DungeonRunService` (Phase 12.2.B
 * solo farm dungeon):
 *
 *   - Solo `DungeonRun`: 1 character / run, lifecycle `ACTIVE →
 *     COMPLETED → CLAIMED`, claim 1 lần / character.
 *   - Party `PartyDungeonRoom` + `PartyDungeonRun`: multi-member /
 *     run, lifecycle room `LOBBY → IN_PROGRESS → COMPLETED/FAILED/
 *     CANCELED`. Reward grant qua `PartyDungeonRewardClaim` row /
 *     participant + idempotent CAS.
 *
 * Hard invariants (test-enforced):
 *   1. Một party chỉ có 1 active room tại một thời điểm
 *      (`maxActiveRoomPerParty=1`). Service `assertNoActiveRoom`.
 *   2. Chỉ leader hiện tại của party (qua membership) được tạo /
 *      start / cancel room.
 *   3. Chỉ active member của cùng party mới được join room. Người
 *      ngoài party → `NOT_PARTY_MEMBER` → 403/404 mask ở
 *      controller.
 *   4. `startRun` reject nếu `< COOP_DUNGEON_LIMITS.minMembers`
 *      active participant hoặc tồn tại participant chưa ready.
 *   5. `dungeonKey` phải có trong shared catalog `DUNGEONS` (gate ở
 *      `canStartPartyDungeon`).
 *   6. Reward claim idempotent qua UNIQUE `(runId, characterId)` +
 *      CAS update `status='PENDING'` → `'CLAIMED'`. 2 concurrent
 *      claim → đúng 1 winner ghi ledger.
 *   7. Non-participant không claim được (claim row chỉ tồn tại cho
 *      participant snapshot lúc startRun).
 *   8. Run `COMPLETED` / `FAILED` / `CANCELED` không re-finish.
 *
 * Foundation mode (Phase 20.1):
 *   - `startRun` auto-resolve inline: trong cùng tx `startRun`,
 *     server đặt `result=CLEAR` (foundation simple), tạo reward
 *     claim rows, set room `COMPLETED`. Phase 20.2+ sẽ tách thành
 *     persistent IN_PROGRESS state cho realtime combat.
 *   - Reward = clone `DungeonDef.runReward` cho mỗi participant
 *     (xem `computePartyDungeonRewardSplit`). KHÔNG share pool /
 *     KHÔNG bidding ở foundation.
 */

export type PartyDungeonErrorCode =
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'INVALID_INPUT'
  | 'NOT_IN_PARTY'
  | 'NOT_PARTY_LEADER'
  | 'NOT_PARTY_MEMBER'
  | 'ROOM_ALREADY_EXISTS'
  | 'ROOM_NOT_LOBBY'
  | 'ROOM_NOT_FOUND'
  | 'PARTICIPANT_NOT_FOUND'
  | 'NOT_ENOUGH_MEMBERS'
  | 'NOT_ALL_READY'
  | 'INVALID_DUNGEON'
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_COMPLETED'
  | 'REWARD_NOT_FOUND'
  | 'REWARD_ALREADY_CLAIMED'
  | 'NO_CHARACTER';

export class PartyDungeonError extends Error {
  constructor(public readonly code: PartyDungeonErrorCode) {
    super(code);
  }
}

@Injectable()
export class PartyDungeonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    @Optional()
    @Inject(RealtimeService)
    private readonly realtime: RealtimeService | null = null,
  ) {}

  // ---------------------------------------------------------------------------
  // Internal helpers — membership + room view
  // ---------------------------------------------------------------------------

  /**
   * Trả về active membership của user trong party hiện tại + flag
   * leader. Null = user không ở party active nào.
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

  private async assertCallerIsPartyMember(
    userId: string,
    partyId: string,
  ): Promise<void> {
    const m = await this.prisma.partyMember.findFirst({
      where: { userId, partyId, leftAt: null },
    });
    if (!m) throw new PartyDungeonError('NOT_PARTY_MEMBER');
  }

  /**
   * Snapshot character đang dùng cho user (Phase 20.1: lấy character
   * đầu tiên theo `createdAt asc`). Future phase có thể support
   * multi-character pick.
   */
  private async pickCharacterIdForUser(userId: string): Promise<string | null> {
    const ch = await this.prisma.character.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return ch?.id ?? null;
  }

  private toRoomDto(r: {
    id: string;
    partyId: string;
    leaderUserId: string;
    dungeonKey: string;
    status: PrismaPartyDungeonRoomStatus;
    minMembers: number;
    maxMembers: number;
    currentRunId: string | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    canceledAt: Date | null;
  }): PartyDungeonRoomDto {
    return {
      id: r.id,
      partyId: r.partyId,
      leaderUserId: r.leaderUserId,
      dungeonKey: r.dungeonKey,
      status: r.status,
      minMembers: r.minMembers,
      maxMembers: r.maxMembers,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      canceledAt: r.canceledAt?.toISOString() ?? null,
      currentRunId: r.currentRunId,
    };
  }

  private toParticipantDto(
    p: {
      id: string;
      roomId: string;
      userId: string;
      characterId: string | null;
      readyAt: Date | null;
      joinedAt: Date;
      leftAt: Date | null;
      resultStatus: PrismaPartyDungeonRunResult | null;
    },
    characterName: string | null = null,
  ): PartyDungeonParticipantDto {
    return {
      id: p.id,
      roomId: p.roomId,
      userId: p.userId,
      characterId: p.characterId,
      characterName,
      readyAt: p.readyAt?.toISOString() ?? null,
      joinedAt: p.joinedAt.toISOString(),
      leftAt: p.leftAt?.toISOString() ?? null,
      resultStatus: p.resultStatus,
    };
  }

  private toRunDto(r: {
    id: string;
    roomId: string;
    partyId: string;
    dungeonKey: string;
    result: PrismaPartyDungeonRunResult;
    startedAt: Date;
    finishedAt: Date | null;
    combatSummaryJson: Prisma.JsonValue | null;
    rewardSummaryJson: Prisma.JsonValue | null;
  }): PartyDungeonRunDto {
    return {
      id: r.id,
      roomId: r.roomId,
      partyId: r.partyId,
      dungeonKey: r.dungeonKey,
      result: r.result,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      combatSummaryJson:
        (r.combatSummaryJson as Record<string, unknown> | null) ?? null,
      rewardSummaryJson:
        (r.rewardSummaryJson as Record<string, unknown> | null) ?? null,
    };
  }

  private toRewardClaimDto(c: {
    id: string;
    runId: string;
    userId: string;
    characterId: string;
    status: PrismaPartyDungeonRewardClaimStatus;
    rewardJson: Prisma.JsonValue;
    claimedAt: Date | null;
    createdAt: Date;
  }): PartyDungeonRewardClaimDto {
    return {
      id: c.id,
      runId: c.runId,
      userId: c.userId,
      characterId: c.characterId,
      status: c.status,
      rewardJson: (c.rewardJson as unknown as PartyDungeonRewardPreview) ?? {},
      claimedAt: c.claimedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Public read
  // ---------------------------------------------------------------------------

  /**
   * Trả về active room của party caller (null nếu không ở party
   * hoặc party chưa tạo room). Bao gồm:
   *   - `room`: trạng thái room hiện tại.
   *   - `participants`: list active participant với character name.
   *   - `currentRun`: run gần nhất gắn với room (nếu đã start).
   *   - `myReward`: reward claim row của caller (nếu đã có).
   */
  async getMyRoom(userId: string): Promise<MyPartyDungeonRoomResponse> {
    const m = await this.getActiveMembership(userId);
    if (!m) return { room: null, participants: [], currentRun: null, myReward: null };

    const room = await this.prisma.partyDungeonRoom.findFirst({
      where: {
        partyId: m.partyId,
        status: {
          notIn: [
            PrismaPartyDungeonRoomStatus.CANCELED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!room) return { room: null, participants: [], currentRun: null, myReward: null };

    const participants = await this.listParticipantsForRoom(room.id);

    let currentRun: PartyDungeonRunDto | null = null;
    let myReward: PartyDungeonRewardClaimDto | null = null;
    if (room.currentRunId) {
      const run = await this.prisma.partyDungeonRun.findUnique({
        where: { id: room.currentRunId },
      });
      if (run) currentRun = this.toRunDto(run);
      const claim = await this.prisma.partyDungeonRewardClaim.findFirst({
        where: { runId: room.currentRunId, userId },
      });
      if (claim) myReward = this.toRewardClaimDto(claim);
    }

    return {
      room: this.toRoomDto(room),
      participants,
      currentRun,
      myReward,
    };
  }

  async listParticipantsForRoom(roomId: string): Promise<PartyDungeonParticipantDto[]> {
    const rows = await this.prisma.partyDungeonParticipant.findMany({
      where: { roomId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });
    if (rows.length === 0) return [];
    const charIds = rows
      .map((r) => r.characterId)
      .filter((id): id is string => !!id);
    const chars = charIds.length
      ? await this.prisma.character.findMany({
          where: { id: { in: charIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(chars.map((c) => [c.id, c.name]));
    return rows.map((r) =>
      this.toParticipantDto(r, r.characterId ? nameById.get(r.characterId) ?? null : null),
    );
  }

  // ---------------------------------------------------------------------------
  // Mutations — room lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Leader tạo room cho dungeon `dungeonKey`. Reject nếu:
   *   - Caller không ở party → `NOT_IN_PARTY`.
   *   - Caller không phải leader → `NOT_PARTY_LEADER`.
   *   - Party đã có active room → `ROOM_ALREADY_EXISTS`.
   *   - `dungeonKey` không hợp lệ → `INVALID_DUNGEON`.
   *
   * Auto-join leader làm participant đầu tiên (chưa ready).
   */
  async createRoom(input: {
    leaderUserId: string;
    dungeonKey: string;
  }): Promise<MyPartyDungeonRoomResponse> {
    if (!dungeonByKey(input.dungeonKey)) {
      throw new PartyDungeonError('INVALID_DUNGEON');
    }

    const m = await this.getActiveMembership(input.leaderUserId);
    if (!m) throw new PartyDungeonError('NOT_IN_PARTY');
    if (!m.isLeader) throw new PartyDungeonError('NOT_PARTY_LEADER');

    const leaderCharId = await this.pickCharacterIdForUser(input.leaderUserId);
    if (!leaderCharId) throw new PartyDungeonError('NO_CHARACTER');

    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.partyDungeonRoom.findFirst({
        where: {
          partyId: m.partyId,
          status: {
            notIn: [
              PrismaPartyDungeonRoomStatus.COMPLETED,
              PrismaPartyDungeonRoomStatus.FAILED,
              PrismaPartyDungeonRoomStatus.CANCELED,
            ],
          },
        },
      });
      if (existing) {
        throw new PartyDungeonError('ROOM_ALREADY_EXISTS');
      }
      const room = await tx.partyDungeonRoom.create({
        data: {
          partyId: m.partyId,
          leaderUserId: input.leaderUserId,
          dungeonKey: input.dungeonKey,
          status: PrismaPartyDungeonRoomStatus.LOBBY,
          minMembers: COOP_DUNGEON_LIMITS.minMembers,
          maxMembers: COOP_DUNGEON_LIMITS.maxMembers,
        },
      });
      await tx.partyDungeonParticipant.create({
        data: {
          roomId: room.id,
          userId: input.leaderUserId,
          characterId: leaderCharId,
        },
      });
      return room;
    });

    this.emitRoomUpdated(created.id);
    return this.getMyRoom(input.leaderUserId);
  }

  /**
   * Member của party hiện tại join room qua active party. Reject nếu:
   *   - Caller không ở party → `NOT_IN_PARTY`.
   *   - Caller không ở cùng party với room → `NOT_PARTY_MEMBER`.
   *   - Room không LOBBY → `ROOM_NOT_LOBBY`.
   *   - Đã max → `ROOM_NOT_LOBBY` (foundation: simple, không tách
   *     mã riêng).
   *
   * Idempotent với cùng `(roomId, userId)`: nếu đã active participant,
   * trả về room view không thay đổi.
   */
  async joinFromParty(input: {
    userId: string;
    roomId: string;
  }): Promise<MyPartyDungeonRoomResponse> {
    const m = await this.getActiveMembership(input.userId);
    if (!m) throw new PartyDungeonError('NOT_IN_PARTY');

    const room = await this.prisma.partyDungeonRoom.findUnique({
      where: { id: input.roomId },
    });
    if (!room) throw new PartyDungeonError('ROOM_NOT_FOUND');
    if (room.partyId !== m.partyId) {
      throw new PartyDungeonError('NOT_PARTY_MEMBER');
    }
    if (
      room.status !== PrismaPartyDungeonRoomStatus.LOBBY &&
      room.status !== PrismaPartyDungeonRoomStatus.READY_CHECK
    ) {
      throw new PartyDungeonError('ROOM_NOT_LOBBY');
    }

    const charId = await this.pickCharacterIdForUser(input.userId);
    if (!charId) throw new PartyDungeonError('NO_CHARACTER');

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.partyDungeonParticipant.findUnique({
        where: { roomId_userId: { roomId: input.roomId, userId: input.userId } },
      });
      if (existing) {
        // Re-activate nếu trước đó leftAt set.
        if (existing.leftAt !== null) {
          await tx.partyDungeonParticipant.update({
            where: { id: existing.id },
            data: { leftAt: null, readyAt: null, characterId: charId },
          });
        }
        return;
      }
      const active = await tx.partyDungeonParticipant.count({
        where: { roomId: input.roomId, leftAt: null },
      });
      if (active >= room.maxMembers) {
        throw new PartyDungeonError('ROOM_NOT_LOBBY');
      }
      await tx.partyDungeonParticipant.create({
        data: {
          roomId: input.roomId,
          userId: input.userId,
          characterId: charId,
        },
      });
    });

    this.emitRoomUpdated(input.roomId);
    return this.getMyRoom(input.userId);
  }

  /**
   * Member set ready. Reject nếu room không LOBBY hoặc caller không
   * phải active participant.
   */
  async setReady(input: {
    userId: string;
    roomId: string;
  }): Promise<MyPartyDungeonRoomResponse> {
    return this.toggleReady({ ...input, ready: true });
  }

  async cancelReady(input: {
    userId: string;
    roomId: string;
  }): Promise<MyPartyDungeonRoomResponse> {
    return this.toggleReady({ ...input, ready: false });
  }

  private async toggleReady(input: {
    userId: string;
    roomId: string;
    ready: boolean;
  }): Promise<MyPartyDungeonRoomResponse> {
    const room = await this.prisma.partyDungeonRoom.findUnique({
      where: { id: input.roomId },
    });
    if (!room) throw new PartyDungeonError('ROOM_NOT_FOUND');
    if (
      room.status !== PrismaPartyDungeonRoomStatus.LOBBY &&
      room.status !== PrismaPartyDungeonRoomStatus.READY_CHECK
    ) {
      throw new PartyDungeonError('ROOM_NOT_LOBBY');
    }
    await this.assertCallerIsPartyMember(input.userId, room.partyId);

    const part = await this.prisma.partyDungeonParticipant.findUnique({
      where: { roomId_userId: { roomId: input.roomId, userId: input.userId } },
    });
    if (!part || part.leftAt !== null) {
      throw new PartyDungeonError('PARTICIPANT_NOT_FOUND');
    }
    await this.prisma.partyDungeonParticipant.update({
      where: { id: part.id },
      data: { readyAt: input.ready ? new Date() : null },
    });

    this.emitReadyUpdated({
      roomId: input.roomId,
      partyId: room.partyId,
      userId: input.userId,
      ready: input.ready,
    });
    return this.getMyRoom(input.userId);
  }

  /**
   * Leader start run. Validate:
   *   - Caller phải là leader hiện tại (re-check qua membership).
   *   - dungeonKey valid (gate ở `canStartPartyDungeon`).
   *   - Đủ `minMembers` active participant + tất cả ready.
   *   - Room đang `LOBBY` hoặc `READY_CHECK`.
   *
   * Phase 20.1 foundation: auto-resolve inline trong cùng tx →
   * tạo `PartyDungeonRun` (result=CLEAR), set room COMPLETED, tạo
   * `PartyDungeonRewardClaim` PENDING cho mỗi participant.
   */
  async startRun(input: {
    leaderUserId: string;
    roomId: string;
  }): Promise<MyPartyDungeonRoomResponse> {
    const room = await this.prisma.partyDungeonRoom.findUnique({
      where: { id: input.roomId },
    });
    if (!room) throw new PartyDungeonError('ROOM_NOT_FOUND');

    const m = await this.getActiveMembership(input.leaderUserId);
    if (!m || m.partyId !== room.partyId) {
      throw new PartyDungeonError('NOT_PARTY_MEMBER');
    }
    if (!m.isLeader) throw new PartyDungeonError('NOT_PARTY_LEADER');

    const participants = await this.prisma.partyDungeonParticipant.findMany({
      where: { roomId: input.roomId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });

    const gate = canStartPartyDungeon({
      callerUserId: input.leaderUserId,
      leaderUserId: room.leaderUserId,
      dungeonKey: room.dungeonKey,
      roomStatus: room.status,
      participants: participants.map((p) => ({
        userId: p.userId,
        readyAt: p.readyAt?.toISOString() ?? null,
        leftAt: p.leftAt?.toISOString() ?? null,
      })),
      minMembers: room.minMembers,
    });
    if (!gate.ok) {
      switch (gate.code) {
        case 'INVALID_DUNGEON':
          throw new PartyDungeonError('INVALID_DUNGEON');
        case 'NOT_LEADER':
          throw new PartyDungeonError('NOT_PARTY_LEADER');
        case 'NOT_ENOUGH_MEMBERS':
          throw new PartyDungeonError('NOT_ENOUGH_MEMBERS');
        case 'NOT_ALL_READY':
          throw new PartyDungeonError('NOT_ALL_READY');
        case 'ROOM_NOT_LOBBY':
          throw new PartyDungeonError('ROOM_NOT_LOBBY');
      }
    }

    const split = computePartyDungeonRewardSplit({
      dungeonKey: room.dungeonKey,
      participantUserIds: participants.map((p) => p.userId),
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const run = await tx.partyDungeonRun.create({
        data: {
          roomId: room.id,
          partyId: room.partyId,
          dungeonKey: room.dungeonKey,
          result: PrismaPartyDungeonRunResult.CLEAR,
          startedAt: now,
          finishedAt: now,
          combatSummaryJson: {
            mode: 'foundation-auto-resolve',
            participantCount: participants.length,
          } as Prisma.InputJsonValue,
          rewardSummaryJson: {
            participantUserIds: participants.map((p) => p.userId),
          } as Prisma.InputJsonValue,
        },
      });

      // Create reward claim rows for participants with valid character.
      const claimRows: Array<{
        userId: string;
        characterId: string;
        id: string;
      }> = [];
      for (const p of participants) {
        if (!p.characterId) continue;
        const reward = split.get(p.userId);
        if (!reward) continue;
        const claim = await tx.partyDungeonRewardClaim.create({
          data: {
            runId: run.id,
            userId: p.userId,
            characterId: p.characterId,
            status: PrismaPartyDungeonRewardClaimStatus.PENDING,
            rewardJson: reward as unknown as Prisma.InputJsonValue,
          },
        });
        claimRows.push({ userId: p.userId, characterId: p.characterId, id: claim.id });
      }

      await tx.partyDungeonParticipant.updateMany({
        where: { roomId: room.id, leftAt: null },
        data: { resultStatus: PrismaPartyDungeonRunResult.CLEAR },
      });

      await tx.partyDungeonRoom.update({
        where: { id: room.id },
        data: {
          status: PrismaPartyDungeonRoomStatus.COMPLETED,
          startedAt: now,
          finishedAt: now,
          currentRunId: run.id,
        },
      });

      return { run, claimRows };
    });

    // Emit WS events (best-effort, post-commit).
    this.emitStarted({
      roomId: room.id,
      partyId: room.partyId,
      runId: result.run.id,
      dungeonKey: room.dungeonKey,
    });
    this.emitCompleted({
      roomId: room.id,
      partyId: room.partyId,
      runId: result.run.id,
      result: PrismaPartyDungeonRunResult.CLEAR,
    });
    for (const c of result.claimRows) {
      this.emitRewardAvailable({
        roomId: room.id,
        partyId: room.partyId,
        runId: result.run.id,
        userId: c.userId,
        rewardClaimId: c.id,
      });
    }
    this.emitRoomUpdated(room.id);

    return this.getMyRoom(input.leaderUserId);
  }

  /**
   * Leader cancel room khi đang LOBBY/READY_CHECK. Reject nếu room
   * đã start (foundation policy — không hỗ trợ cancel mid-run).
   */
  async cancelRoom(input: {
    leaderUserId: string;
    roomId: string;
  }): Promise<MyPartyDungeonRoomResponse> {
    const room = await this.prisma.partyDungeonRoom.findUnique({
      where: { id: input.roomId },
    });
    if (!room) throw new PartyDungeonError('ROOM_NOT_FOUND');

    const m = await this.getActiveMembership(input.leaderUserId);
    if (!m || m.partyId !== room.partyId) {
      throw new PartyDungeonError('NOT_PARTY_MEMBER');
    }
    if (!m.isLeader) throw new PartyDungeonError('NOT_PARTY_LEADER');
    if (
      room.status !== PrismaPartyDungeonRoomStatus.LOBBY &&
      room.status !== PrismaPartyDungeonRoomStatus.READY_CHECK
    ) {
      throw new PartyDungeonError('ROOM_NOT_LOBBY');
    }
    await this.prisma.partyDungeonRoom.update({
      where: { id: room.id },
      data: {
        status: PrismaPartyDungeonRoomStatus.CANCELED,
        canceledAt: new Date(),
      },
    });
    this.emitRoomUpdated(room.id);
    return this.getMyRoom(input.leaderUserId);
  }

  // ---------------------------------------------------------------------------
  // Reward claim
  // ---------------------------------------------------------------------------

  async getRunDetail(input: {
    userId: string;
    runId: string;
  }): Promise<{ run: PartyDungeonRunDto; rewards: PartyDungeonRewardClaimDto[] }> {
    const run = await this.prisma.partyDungeonRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) throw new PartyDungeonError('RUN_NOT_FOUND');

    // Authz: caller phải là participant của run này.
    const part = await this.prisma.partyDungeonParticipant.findFirst({
      where: { roomId: run.roomId, userId: input.userId },
    });
    if (!part) throw new PartyDungeonError('NOT_PARTY_MEMBER');

    const rewards = await this.prisma.partyDungeonRewardClaim.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      run: this.toRunDto(run),
      rewards: rewards.map((r) => this.toRewardClaimDto(r)),
    };
  }

  /**
   * Member claim reward. Reject:
   *   - Run không tồn tại → `RUN_NOT_FOUND`.
   *   - Run không COMPLETED (CLEAR) → `RUN_NOT_COMPLETED`.
   *   - Claim row không tồn tại cho caller → `REWARD_NOT_FOUND`
   *     (non-participant cũng rơi vào nhánh này).
   *   - Claim đã CLAIMED → `REWARD_ALREADY_CLAIMED` (idempotent
   *     guard).
   *
   * Atomic trong tx:
   *   1. CAS update claim PENDING → CLAIMED + set claimedAt.
   *   2. Grant currency qua `CurrencyService.applyTx`
   *      (reason='PARTY_DUNGEON_REWARD', refType='PartyDungeonReward
   *      Claim', refId=claimId).
   *   3. Grant items qua `InventoryService.grantTx` (cùng reason).
   *   4. Increment exp qua `tx.character.update`.
   */
  async claimReward(input: {
    userId: string;
    runId: string;
  }): Promise<PartyDungeonRewardClaimDto> {
    const run = await this.prisma.partyDungeonRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) throw new PartyDungeonError('RUN_NOT_FOUND');
    if (run.result !== PrismaPartyDungeonRunResult.CLEAR) {
      throw new PartyDungeonError('RUN_NOT_COMPLETED');
    }

    const claim = await this.prisma.partyDungeonRewardClaim.findFirst({
      where: { runId: input.runId, userId: input.userId },
    });
    if (!claim) throw new PartyDungeonError('REWARD_NOT_FOUND');
    if (claim.status === PrismaPartyDungeonRewardClaimStatus.CLAIMED) {
      throw new PartyDungeonError('REWARD_ALREADY_CLAIMED');
    }

    const reward = (claim.rewardJson as unknown as PartyDungeonRewardPreview) ?? {};

    await this.prisma.$transaction(async (tx) => {
      // CAS guard: chỉ winner mới flip PENDING → CLAIMED.
      const upd = await tx.partyDungeonRewardClaim.updateMany({
        where: {
          id: claim.id,
          status: PrismaPartyDungeonRewardClaimStatus.PENDING,
        },
        data: {
          status: PrismaPartyDungeonRewardClaimStatus.CLAIMED,
          claimedAt: new Date(),
        },
      });
      if (upd.count === 0) {
        throw new PartyDungeonError('REWARD_ALREADY_CLAIMED');
      }

      // Currency: linhThach + tienNgoc.
      if (reward.linhThach && reward.linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId: claim.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(reward.linhThach),
          reason: 'PARTY_DUNGEON_REWARD',
          refType: 'PartyDungeonRewardClaim',
          refId: claim.id,
          actorUserId: claim.userId,
        });
      }
      if (reward.tienNgoc && reward.tienNgoc > 0) {
        await this.currency.applyTx(tx, {
          characterId: claim.characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(reward.tienNgoc),
          reason: 'PARTY_DUNGEON_REWARD',
          refType: 'PartyDungeonRewardClaim',
          refId: claim.id,
          actorUserId: claim.userId,
        });
      }

      // Items.
      if (reward.items && reward.items.length > 0) {
        await this.inventory.grantTx(
          tx,
          claim.characterId,
          reward.items.map((i) => ({ itemKey: i.itemKey, qty: i.qty })),
          {
            reason: 'PARTY_DUNGEON_REWARD',
            refType: 'PartyDungeonRewardClaim',
            refId: claim.id,
            actorUserId: claim.userId,
          },
        );
      }

      // Exp.
      if (reward.exp && reward.exp > 0) {
        await tx.character.update({
          where: { id: claim.characterId },
          data: { exp: { increment: reward.exp } },
        });
      }
    });

    const updated = await this.prisma.partyDungeonRewardClaim.findUnique({
      where: { id: claim.id },
    });
    if (!updated) throw new PartyDungeonError('REWARD_NOT_FOUND');
    return this.toRewardClaimDto(updated);
  }

  // ---------------------------------------------------------------------------
  // Realtime helpers (best-effort)
  // ---------------------------------------------------------------------------

  private async emitRoomUpdated(roomId: string): Promise<void> {
    if (!this.realtime) return;
    try {
      const room = await this.prisma.partyDungeonRoom.findUnique({
        where: { id: roomId },
      });
      if (!room) return;
      const active = await this.prisma.partyDungeonParticipant.findMany({
        where: { roomId, leftAt: null },
        select: { userId: true, readyAt: true },
      });
      const payload: PartyDungeonRoomUpdatedBroadcastPayload = {
        roomId,
        partyId: room.partyId,
        status: room.status,
        participantsCount: active.length,
        readyCount: active.filter((p) => p.readyAt !== null).length,
      };
      for (const p of active) {
        this.realtime.emitToUser(p.userId, 'party-dungeon:room-updated', payload);
      }
    } catch {
      /* best-effort */
    }
  }

  private emitReadyUpdated(p: PartyDungeonReadyUpdatedBroadcastPayload): void {
    if (!this.realtime) return;
    void this.fanoutToRoomParticipants(p.roomId, 'party-dungeon:ready-updated', p);
  }

  private emitStarted(p: PartyDungeonStartedBroadcastPayload): void {
    if (!this.realtime) return;
    void this.fanoutToRoomParticipants(p.roomId, 'party-dungeon:started', p);
  }

  private emitCompleted(p: PartyDungeonCompletedBroadcastPayload): void {
    if (!this.realtime) return;
    void this.fanoutToRoomParticipants(p.roomId, 'party-dungeon:completed', p);
  }

  private emitRewardAvailable(p: PartyDungeonRewardAvailableBroadcastPayload): void {
    if (!this.realtime) return;
    // Reward is per-user — emit only to owner.
    try {
      this.realtime.emitToUser(p.userId, 'party-dungeon:reward-available', p);
    } catch {
      /* best-effort */
    }
  }

  private async fanoutToRoomParticipants<T>(
    roomId: string,
    event:
      | 'party-dungeon:room-updated'
      | 'party-dungeon:ready-updated'
      | 'party-dungeon:started'
      | 'party-dungeon:completed'
      | 'party-dungeon:reward-available',
    payload: T,
  ): Promise<void> {
    if (!this.realtime) return;
    try {
      const active = await this.prisma.partyDungeonParticipant.findMany({
        where: { roomId, leftAt: null },
        select: { userId: true },
      });
      for (const p of active) {
        this.realtime.emitToUser(p.userId, event, payload);
      }
    } catch {
      /* best-effort */
    }
  }
}
