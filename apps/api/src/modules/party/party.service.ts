import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  PartyInviteStatus as PrismaPartyInviteStatus,
  PartyRole as PrismaPartyRole,
  PartyStatus as PrismaPartyStatus,
  Prisma,
} from '@prisma/client';
import {
  PARTY_LIMITS,
  type PartyDto,
  type PartyInviteDto,
  type PartyMemberDto,
  type PartyMemberJoinedBroadcastPayload,
  type PartyMemberLeftBroadcastPayload,
  type PartyLeaderChangedBroadcastPayload,
  type PartyInviteBroadcastPayload,
  type PartyUpdatedBroadcastPayload,
  canDisbandParty,
  canInviteToParty,
  canKickPartyMember,
  canTransferLeader,
  computePartyInviteExpiresAt,
  validatePartyName,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SocialService } from '../social/social.service';

/**
 * Phase 19.4 — Group / Party System Upgrade.
 *
 * PartyService quản lý lifecycle party + invite flow + membership.
 * Tách rõ semantics khỏi `ChatGroupService` (chat nhóm):
 *
 *   - Party có trưởng nhóm, role, max 5 thành viên, 1 active party
 *     mỗi user.
 *   - Party invite có expiry (10 phút mặc định).
 *   - Chỉ leader được invite / kick / transfer / disband (Phase 19.4
 *     policy mặc định).
 *
 * Hard invariants (test-enforced):
 *   1. Một user chỉ có 1 active party tại một thời điểm.
 *   2. Block 2 chiều cấm invite + cấm accept.
 *   3. Invite expired không accept được.
 *   4. Race accept duplicate không tạo double member (unique constraint
 *      `(partyId, userId)` + transaction).
 *   5. Leader rời → auto-transfer cho member còn lại lâu năm nhất.
 *      Nếu chỉ còn leader thì auto-disband party.
 *   6. Disband cascade: set `Party.status=DISBANDED` + đánh dấu mọi
 *      member còn active là `leftAt`, cancel mọi pending invite.
 */

export type PartyErrorCode =
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'INVALID_INPUT'
  | 'SELF_NOT_ALLOWED'
  | 'ALREADY_IN_PARTY'
  | 'INVITEE_IN_OTHER_PARTY'
  | 'BLOCKED'
  | 'PARTY_FULL'
  | 'INVITE_EXPIRED'
  | 'INVITE_NOT_PENDING'
  | 'DUPLICATE_INVITE'
  | 'TOO_MANY_PENDING_INVITES'
  | 'PARTY_DISBANDED'
  | 'NOT_MEMBER'
  | 'TARGET_NOT_MEMBER';

export class PartyError extends Error {
  constructor(public readonly code: PartyErrorCode) {
    super(code);
  }
}

@Injectable()
export class PartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly social: SocialService,
    @Optional()
    @Inject(RealtimeService)
    private readonly realtime: RealtimeService | null = null,
  ) {}

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Phase 19.4 — best-effort live online check via RealtimeService.
   * Fallback `false` khi presence chưa wire (vd unit test). FE còn
   * có thể query `/social/presence` để xác nhận.
   */
  private isOnlineSafe(userId: string): boolean {
    try {
      return this.realtime?.isOnline(userId) ?? false;
    } catch {
      return false;
    }
  }

  private toPartyDto(party: {
    id: string;
    leaderUserId: string;
    name: string | null;
    status: PrismaPartyStatus;
    maxMembers: number;
    createdAt: Date;
    updatedAt: Date;
    disbandedAt: Date | null;
  }, memberCount: number): PartyDto {
    return {
      id: party.id,
      leaderUserId: party.leaderUserId,
      name: party.name,
      status: party.status,
      maxMembers: party.maxMembers,
      memberCount,
      createdAt: party.createdAt.toISOString(),
      updatedAt: party.updatedAt.toISOString(),
      disbandedAt: party.disbandedAt ? party.disbandedAt.toISOString() : null,
    };
  }

  private toMemberDto(
    row: {
      id: string;
      partyId: string;
      userId: string;
      role: PrismaPartyRole;
      joinedAt: Date;
      leftAt: Date | null;
    },
    displayName: string | null,
  ): PartyMemberDto {
    return {
      id: row.id,
      partyId: row.partyId,
      userId: row.userId,
      displayName,
      role: row.role,
      online: this.isOnlineSafe(row.userId),
      joinedAt: row.joinedAt.toISOString(),
      leftAt: row.leftAt ? row.leftAt.toISOString() : null,
    };
  }

  private async toInviteDto(invite: {
    id: string;
    partyId: string;
    inviterUserId: string;
    inviteeUserId: string;
    status: PrismaPartyInviteStatus;
    createdAt: Date;
    expiresAt: Date;
    respondedAt: Date | null;
  }): Promise<PartyInviteDto> {
    const [party, characters] = await Promise.all([
      this.prisma.party.findUnique({
        where: { id: invite.partyId },
        select: { name: true },
      }),
      this.prisma.character.findMany({
        where: { userId: { in: [invite.inviterUserId, invite.inviteeUserId] } },
        select: { userId: true, name: true },
      }),
    ]);
    const nameByUserId = new Map(characters.map((c) => [c.userId, c.name]));
    return {
      id: invite.id,
      partyId: invite.partyId,
      inviterUserId: invite.inviterUserId,
      inviterDisplayName: nameByUserId.get(invite.inviterUserId) ?? null,
      inviteeUserId: invite.inviteeUserId,
      inviteeDisplayName: nameByUserId.get(invite.inviteeUserId) ?? null,
      status: invite.status,
      partyName: party?.name ?? null,
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      respondedAt: invite.respondedAt ? invite.respondedAt.toISOString() : null,
    };
  }

  /**
   * Lazy-expire pending invite quá hạn. Gọi trước list / accept để
   * trạng thái sync. Không throw.
   */
  private async lazyExpireInvites(): Promise<void> {
    try {
      const now = new Date();
      await this.prisma.partyInvite.updateMany({
        where: {
          status: PrismaPartyInviteStatus.PENDING,
          expiresAt: { lte: now },
        },
        data: {
          status: PrismaPartyInviteStatus.EXPIRED,
          respondedAt: now,
        },
      });
    } catch {
      // ignore — best-effort.
    }
  }

  private async getActiveMembership(userId: string): Promise<{
    partyId: string;
    role: PrismaPartyRole;
  } | null> {
    const m = await this.prisma.partyMember.findFirst({
      where: { userId, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });
    if (!m) return null;
    const party = await this.prisma.party.findUnique({
      where: { id: m.partyId },
      select: { status: true },
    });
    if (!party || party.status !== PrismaPartyStatus.ACTIVE) return null;
    return { partyId: m.partyId, role: m.role };
  }

  private async listActiveMembersForParty(
    partyId: string,
  ): Promise<PartyMemberDto[]> {
    const rows = await this.prisma.partyMember.findMany({
      where: { partyId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });
    if (rows.length === 0) return [];
    const userIds = rows.map((r) => r.userId);
    const chars = await this.prisma.character.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, name: true },
    });
    const nameByUserId = new Map(chars.map((c) => [c.userId, c.name]));
    return rows.map((r) =>
      this.toMemberDto(r, nameByUserId.get(r.userId) ?? null),
    );
  }

  private async loadPartyView(partyId: string): Promise<{
    party: PartyDto;
    members: PartyMemberDto[];
  } | null> {
    const party = await this.prisma.party.findUnique({ where: { id: partyId } });
    if (!party) return null;
    const members = await this.listActiveMembersForParty(partyId);
    return {
      party: this.toPartyDto(party, members.length),
      members,
    };
  }

  private emitPartyUpdated(
    party: PartyDto,
    members: PartyMemberDto[],
  ): void {
    if (!this.realtime) return;
    const payload: PartyUpdatedBroadcastPayload = { party, members };
    for (const m of members) {
      try {
        this.realtime.emitToUser(m.userId, 'party:updated', payload);
      } catch {
        // best-effort
      }
    }
  }

  private emitPartyMemberJoined(
    members: PartyMemberDto[],
    joined: PartyMemberDto,
  ): void {
    if (!this.realtime) return;
    const payload: PartyMemberJoinedBroadcastPayload = {
      partyId: joined.partyId,
      member: joined,
    };
    for (const m of members) {
      try {
        this.realtime.emitToUser(m.userId, 'party:member-joined', payload);
      } catch {
        // best-effort
      }
    }
  }

  private emitPartyMemberLeft(
    notifyUserIds: readonly string[],
    payload: PartyMemberLeftBroadcastPayload,
  ): void {
    if (!this.realtime) return;
    for (const uid of notifyUserIds) {
      try {
        this.realtime.emitToUser(uid, 'party:member-left', payload);
      } catch {
        // best-effort
      }
    }
  }

  private emitLeaderChanged(
    members: PartyMemberDto[],
    payload: PartyLeaderChangedBroadcastPayload,
  ): void {
    if (!this.realtime) return;
    for (const m of members) {
      try {
        this.realtime.emitToUser(m.userId, 'party:leader-changed', payload);
      } catch {
        // best-effort
      }
    }
  }

  private async emitInvite(invite: PartyInviteDto): Promise<void> {
    if (!this.realtime) return;
    const payload: PartyInviteBroadcastPayload = { invite };
    try {
      this.realtime.emitToUser(invite.inviteeUserId, 'party:invite', payload);
    } catch {
      // best-effort
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Trả về party hiện tại của user kèm member list. Null nếu user
   * không thuộc party active nào.
   */
  async getMyParty(userId: string): Promise<{
    party: PartyDto | null;
    members: PartyMemberDto[];
  }> {
    const active = await this.getActiveMembership(userId);
    if (!active) return { party: null, members: [] };
    const view = await this.loadPartyView(active.partyId);
    if (!view) return { party: null, members: [] };
    return view;
  }

  /**
   * Tạo party mới với caller làm leader. Reject nếu user đã ở party
   * active khác.
   */
  async createParty(
    leaderUserId: string,
    rawName: string | null | undefined,
  ): Promise<{ party: PartyDto; members: PartyMemberDto[] }> {
    const nameV = validatePartyName(rawName ?? null);
    if (!nameV.ok) throw new PartyError('INVALID_INPUT');

    const active = await this.getActiveMembership(leaderUserId);
    if (active) throw new PartyError('ALREADY_IN_PARTY');

    const created = await this.prisma.$transaction(async (tx) => {
      // Re-check inside transaction to avoid race.
      const stillActive = await tx.partyMember.findFirst({
        where: { userId: leaderUserId, leftAt: null },
      });
      if (stillActive) {
        const p = await tx.party.findUnique({
          where: { id: stillActive.partyId },
          select: { status: true },
        });
        if (p?.status === PrismaPartyStatus.ACTIVE) {
          throw new PartyError('ALREADY_IN_PARTY');
        }
      }
      const party = await tx.party.create({
        data: {
          leaderUserId,
          name: nameV.value,
          status: PrismaPartyStatus.ACTIVE,
          maxMembers: PARTY_LIMITS.maxMembers,
        },
      });
      await tx.partyMember.create({
        data: {
          partyId: party.id,
          userId: leaderUserId,
          role: PrismaPartyRole.LEADER,
        },
      });
      return party;
    });

    const view = await this.loadPartyView(created.id);
    if (!view) throw new PartyError('NOT_FOUND');
    this.emitPartyUpdated(view.party, view.members);
    return view;
  }

  /**
   * Gửi invite từ leader tới invitee. Reject:
   *   - SELF_NOT_ALLOWED nếu inviter === invitee.
   *   - NOT_FOUND nếu inviter không có party active.
   *   - NOT_AUTHORIZED nếu inviter không phải leader.
   *   - BLOCKED nếu 2 user đang block lẫn nhau.
   *   - INVITEE_IN_OTHER_PARTY nếu invitee đã ở party active khác.
   *   - DUPLICATE_INVITE nếu có pending invite cho cùng cặp.
   *   - PARTY_FULL nếu memberCount đã đạt cap.
   *   - TOO_MANY_PENDING_INVITES theo cap per-invitee / per-party.
   */
  async inviteToParty(
    inviterUserId: string,
    inviteeUserId: string,
  ): Promise<PartyInviteDto> {
    if (inviterUserId === inviteeUserId) {
      throw new PartyError('SELF_NOT_ALLOWED');
    }

    const active = await this.getActiveMembership(inviterUserId);
    if (!active) throw new PartyError('NOT_FOUND');
    if (
      !canInviteToParty({
        actorUserId: inviterUserId,
        leaderUserId: await this.getLeaderUserId(active.partyId),
      })
    ) {
      throw new PartyError('NOT_AUTHORIZED');
    }

    if (await this.social.isBlockedBetween(inviterUserId, inviteeUserId)) {
      throw new PartyError('BLOCKED');
    }

    // Invitee không được ở party active khác
    const inviteeActive = await this.getActiveMembership(inviteeUserId);
    if (inviteeActive) throw new PartyError('INVITEE_IN_OTHER_PARTY');

    await this.lazyExpireInvites();

    // Party capacity check
    const memberCount = await this.prisma.partyMember.count({
      where: { partyId: active.partyId, leftAt: null },
    });
    if (memberCount >= PARTY_LIMITS.maxMembers) {
      throw new PartyError('PARTY_FULL');
    }

    // Duplicate pending invite cho cùng cặp
    const dup = await this.prisma.partyInvite.findFirst({
      where: {
        partyId: active.partyId,
        inviteeUserId,
        status: PrismaPartyInviteStatus.PENDING,
      },
    });
    if (dup) throw new PartyError('DUPLICATE_INVITE');

    // Cap per-invitee
    const inviteeBacklog = await this.prisma.partyInvite.count({
      where: {
        inviteeUserId,
        status: PrismaPartyInviteStatus.PENDING,
      },
    });
    if (inviteeBacklog >= PARTY_LIMITS.maxPendingInvitesPerInvitee) {
      throw new PartyError('TOO_MANY_PENDING_INVITES');
    }

    // Cap per-party
    const partyBacklog = await this.prisma.partyInvite.count({
      where: {
        partyId: active.partyId,
        status: PrismaPartyInviteStatus.PENDING,
      },
    });
    if (partyBacklog >= PARTY_LIMITS.maxPendingInvitesPerParty) {
      throw new PartyError('TOO_MANY_PENDING_INVITES');
    }

    const expiresAt = computePartyInviteExpiresAt(new Date());
    const created = await this.prisma.partyInvite.create({
      data: {
        partyId: active.partyId,
        inviterUserId,
        inviteeUserId,
        status: PrismaPartyInviteStatus.PENDING,
        expiresAt,
      },
    });

    const dto = await this.toInviteDto(created);
    await this.emitInvite(dto);
    return dto;
  }

  private async getLeaderUserId(partyId: string): Promise<string> {
    const p = await this.prisma.party.findUnique({
      where: { id: partyId },
      select: { leaderUserId: true },
    });
    if (!p) throw new PartyError('NOT_FOUND');
    return p.leaderUserId;
  }

  /**
   * Accept invite — chuyển PENDING → ACCEPTED + add caller vào party
   * như MEMBER. Reject các condition theo invariant.
   */
  async acceptInvite(
    callerUserId: string,
    inviteId: string,
  ): Promise<{ party: PartyDto; members: PartyMemberDto[] }> {
    await this.lazyExpireInvites();

    const invite = await this.prisma.partyInvite.findUnique({
      where: { id: inviteId },
    });
    if (!invite) throw new PartyError('NOT_FOUND');
    if (invite.inviteeUserId !== callerUserId) {
      throw new PartyError('NOT_AUTHORIZED');
    }
    if (invite.status !== PrismaPartyInviteStatus.PENDING) {
      // Mask expired separately for FE UX.
      if (invite.status === PrismaPartyInviteStatus.EXPIRED) {
        throw new PartyError('INVITE_EXPIRED');
      }
      throw new PartyError('INVITE_NOT_PENDING');
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new PartyError('INVITE_EXPIRED');
    }

    // Caller chưa được ở party khác
    const active = await this.getActiveMembership(callerUserId);
    if (active) throw new PartyError('ALREADY_IN_PARTY');

    const party = await this.prisma.party.findUnique({
      where: { id: invite.partyId },
    });
    if (!party || party.status !== PrismaPartyStatus.ACTIVE) {
      throw new PartyError('PARTY_DISBANDED');
    }

    // Block 2 chiều
    if (await this.social.isBlockedBetween(callerUserId, party.leaderUserId)) {
      throw new PartyError('BLOCKED');
    }

    const joined = await this.prisma.$transaction(async (tx) => {
      // Re-check membership trong transaction để chống race accept
      // duplicate.
      const stillActive = await tx.partyMember.findFirst({
        where: { userId: callerUserId, leftAt: null },
      });
      if (stillActive) {
        const p = await tx.party.findUnique({
          where: { id: stillActive.partyId },
          select: { status: true },
        });
        if (p?.status === PrismaPartyStatus.ACTIVE) {
          throw new PartyError('ALREADY_IN_PARTY');
        }
      }

      const count = await tx.partyMember.count({
        where: { partyId: party.id, leftAt: null },
      });
      if (count >= party.maxMembers) {
        throw new PartyError('PARTY_FULL');
      }

      // Re-check invite status inside transaction to avoid double-accept
      const fresh = await tx.partyInvite.findUnique({
        where: { id: inviteId },
      });
      if (!fresh || fresh.status !== PrismaPartyInviteStatus.PENDING) {
        throw new PartyError('INVITE_NOT_PENDING');
      }

      const member = await tx.partyMember.upsert({
        where: {
          partyId_userId: {
            partyId: party.id,
            userId: callerUserId,
          },
        },
        create: {
          partyId: party.id,
          userId: callerUserId,
          role: PrismaPartyRole.MEMBER,
        },
        // Nếu member cũ đã leftAt và quay lại party qua invite mới
        // → reset leftAt = null để re-active.
        update: {
          role: PrismaPartyRole.MEMBER,
          leftAt: null,
        },
      });

      await tx.partyInvite.update({
        where: { id: inviteId },
        data: {
          status: PrismaPartyInviteStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });

      // Cancel mọi pending invite khác của invitee (đã có party).
      await tx.partyInvite.updateMany({
        where: {
          inviteeUserId: callerUserId,
          status: PrismaPartyInviteStatus.PENDING,
          NOT: { id: inviteId },
        },
        data: {
          status: PrismaPartyInviteStatus.CANCELED,
          respondedAt: new Date(),
        },
      });

      return member;
    });

    const view = await this.loadPartyView(party.id);
    if (!view) throw new PartyError('NOT_FOUND');
    const callerChar = await this.prisma.character.findUnique({
      where: { userId: callerUserId },
      select: { name: true },
    });
    const joinedDto = this.toMemberDto(joined, callerChar?.name ?? null);

    this.emitPartyUpdated(view.party, view.members);
    this.emitPartyMemberJoined(view.members, joinedDto);
    return view;
  }

  async declineInvite(
    callerUserId: string,
    inviteId: string,
  ): Promise<PartyInviteDto> {
    const invite = await this.prisma.partyInvite.findUnique({
      where: { id: inviteId },
    });
    if (!invite) throw new PartyError('NOT_FOUND');
    if (invite.inviteeUserId !== callerUserId) {
      throw new PartyError('NOT_AUTHORIZED');
    }
    if (invite.status !== PrismaPartyInviteStatus.PENDING) {
      throw new PartyError('INVITE_NOT_PENDING');
    }
    const updated = await this.prisma.partyInvite.update({
      where: { id: inviteId },
      data: {
        status: PrismaPartyInviteStatus.DECLINED,
        respondedAt: new Date(),
      },
    });
    return this.toInviteDto(updated);
  }

  async cancelInvite(
    callerUserId: string,
    inviteId: string,
  ): Promise<PartyInviteDto> {
    const invite = await this.prisma.partyInvite.findUnique({
      where: { id: inviteId },
    });
    if (!invite) throw new PartyError('NOT_FOUND');
    if (invite.status !== PrismaPartyInviteStatus.PENDING) {
      throw new PartyError('INVITE_NOT_PENDING');
    }
    // Cho phép inviter HOẶC leader hiện tại của party cancel.
    if (invite.inviterUserId !== callerUserId) {
      const party = await this.prisma.party.findUnique({
        where: { id: invite.partyId },
        select: { leaderUserId: true },
      });
      if (!party || party.leaderUserId !== callerUserId) {
        throw new PartyError('NOT_AUTHORIZED');
      }
    }
    const updated = await this.prisma.partyInvite.update({
      where: { id: inviteId },
      data: {
        status: PrismaPartyInviteStatus.CANCELED,
        respondedAt: new Date(),
      },
    });
    return this.toInviteDto(updated);
  }

  async listIncomingInvites(userId: string): Promise<PartyInviteDto[]> {
    await this.lazyExpireInvites();
    const rows = await this.prisma.partyInvite.findMany({
      where: {
        inviteeUserId: userId,
        status: PrismaPartyInviteStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.toInviteDto(r)));
  }

  async listOutgoingInvites(userId: string): Promise<PartyInviteDto[]> {
    await this.lazyExpireInvites();
    const active = await this.getActiveMembership(userId);
    // Outgoing = invite gửi từ caller (kể cả nếu không còn ở party).
    // Nếu caller là leader đang active → cũng include những invite do
    // member trong party gửi (cùng partyId). Phase 19.4 default policy
    // only leader có thể invite, nên hai tập gần như trùng nhau.
    const where: Prisma.PartyInviteWhereInput = {
      status: PrismaPartyInviteStatus.PENDING,
      OR: [
        { inviterUserId: userId },
        active ? { partyId: active.partyId } : { inviterUserId: userId },
      ],
    };
    const rows = await this.prisma.partyInvite.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.toInviteDto(r)));
  }

  async listMembers(callerUserId: string): Promise<PartyMemberDto[]> {
    const active = await this.getActiveMembership(callerUserId);
    if (!active) return [];
    return this.listActiveMembersForParty(active.partyId);
  }

  /**
   * Caller rời party. Side-effects:
   *   - Nếu là leader, auto-transfer cho member còn lại lâu năm nhất.
   *   - Nếu party còn 1 thành viên (chính leader), party auto-disband.
   *   - Cancel mọi pending invite caller đã gửi.
   */
  async leaveParty(callerUserId: string): Promise<{
    party: PartyDto | null;
    members: PartyMemberDto[];
  }> {
    const active = await this.getActiveMembership(callerUserId);
    if (!active) throw new PartyError('NOT_MEMBER');

    const partyId = active.partyId;
    const party = await this.prisma.party.findUnique({
      where: { id: partyId },
    });
    if (!party) throw new PartyError('NOT_FOUND');

    type LeaderChange = {
      previousLeaderUserId: string;
      newLeaderUserId: string;
    };
    const txState: {
      disbanded: boolean;
      leaderChanged: LeaderChange | null;
    } = { disbanded: false, leaderChanged: null };

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const activeMembers = await tx.partyMember.findMany({
        where: { partyId, leftAt: null },
        orderBy: { joinedAt: 'asc' },
      });

      // Mark caller as left
      await tx.partyMember.updateMany({
        where: { partyId, userId: callerUserId, leftAt: null },
        data: { leftAt: now },
      });

      // Cancel pending invites caller đã gửi.
      await tx.partyInvite.updateMany({
        where: {
          inviterUserId: callerUserId,
          partyId,
          status: PrismaPartyInviteStatus.PENDING,
        },
        data: {
          status: PrismaPartyInviteStatus.CANCELED,
          respondedAt: now,
        },
      });

      const remaining = activeMembers.filter(
        (m) => m.userId !== callerUserId,
      );

      if (remaining.length === 0) {
        // Auto-disband
        await tx.party.update({
          where: { id: partyId },
          data: {
            status: PrismaPartyStatus.DISBANDED,
            disbandedAt: now,
          },
        });
        await tx.partyInvite.updateMany({
          where: {
            partyId,
            status: PrismaPartyInviteStatus.PENDING,
          },
          data: {
            status: PrismaPartyInviteStatus.CANCELED,
            respondedAt: now,
          },
        });
        txState.disbanded = true;
      } else if (party.leaderUserId === callerUserId) {
        // Caller là leader → auto-transfer cho member còn lại lâu
        // năm nhất (joinedAt asc).
        const newLeader = remaining[0];
        await tx.partyMember.update({
          where: { id: newLeader.id },
          data: { role: PrismaPartyRole.LEADER },
        });
        await tx.party.update({
          where: { id: partyId },
          data: { leaderUserId: newLeader.userId },
        });
        txState.leaderChanged = {
          previousLeaderUserId: callerUserId,
          newLeaderUserId: newLeader.userId,
        };
      }
    });

    if (txState.disbanded) {
      const view = await this.loadPartyView(partyId);
      const notifyIds = [
        ...new Set([
          callerUserId,
          ...(view?.members.map((m) => m.userId) ?? []),
        ]),
      ];
      this.emitPartyMemberLeft(notifyIds, {
        partyId,
        userId: callerUserId,
        reason: 'DISBANDED',
      });
      return { party: null, members: [] };
    }

    const view = await this.loadPartyView(partyId);
    if (!view) return { party: null, members: [] };

    const notifyIds = [callerUserId, ...view.members.map((m) => m.userId)];
    this.emitPartyMemberLeft(notifyIds, {
      partyId,
      userId: callerUserId,
      reason: 'LEFT',
    });
    if (txState.leaderChanged) {
      this.emitLeaderChanged(view.members, {
        partyId,
        previousLeaderUserId: txState.leaderChanged.previousLeaderUserId,
        newLeaderUserId: txState.leaderChanged.newLeaderUserId,
      });
    }
    this.emitPartyUpdated(view.party, view.members);
    return view;
  }

  /**
   * Leader kick member khác. Reject nếu caller không phải leader hoặc
   * target không thuộc party. Không cho kick chính mình (dùng leave).
   */
  async kickMember(
    callerUserId: string,
    targetUserId: string,
  ): Promise<{ party: PartyDto; members: PartyMemberDto[] }> {
    const active = await this.getActiveMembership(callerUserId);
    if (!active) throw new PartyError('NOT_MEMBER');
    const leaderUserId = await this.getLeaderUserId(active.partyId);
    if (
      !canKickPartyMember({
        actorUserId: callerUserId,
        leaderUserId,
        targetUserId,
      })
    ) {
      // Phân biệt self-kick vs non-leader để FE UX rõ.
      if (callerUserId === targetUserId) {
        throw new PartyError('SELF_NOT_ALLOWED');
      }
      throw new PartyError('NOT_AUTHORIZED');
    }

    const target = await this.prisma.partyMember.findFirst({
      where: { partyId: active.partyId, userId: targetUserId, leftAt: null },
    });
    if (!target) throw new PartyError('TARGET_NOT_MEMBER');

    await this.prisma.partyMember.update({
      where: { id: target.id },
      data: { leftAt: new Date() },
    });

    const view = await this.loadPartyView(active.partyId);
    if (!view) throw new PartyError('NOT_FOUND');

    const notifyIds = [targetUserId, ...view.members.map((m) => m.userId)];
    this.emitPartyMemberLeft(notifyIds, {
      partyId: active.partyId,
      userId: targetUserId,
      reason: 'KICKED',
    });
    this.emitPartyUpdated(view.party, view.members);
    return view;
  }

  /**
   * Leader chuyển leadership cho thành viên khác trong party.
   */
  async transferLeader(
    callerUserId: string,
    targetUserId: string,
  ): Promise<{ party: PartyDto; members: PartyMemberDto[] }> {
    const active = await this.getActiveMembership(callerUserId);
    if (!active) throw new PartyError('NOT_MEMBER');
    const leaderUserId = await this.getLeaderUserId(active.partyId);
    if (
      !canTransferLeader({
        actorUserId: callerUserId,
        leaderUserId,
        targetUserId,
      })
    ) {
      if (callerUserId === targetUserId) {
        throw new PartyError('SELF_NOT_ALLOWED');
      }
      throw new PartyError('NOT_AUTHORIZED');
    }

    const target = await this.prisma.partyMember.findFirst({
      where: { partyId: active.partyId, userId: targetUserId, leftAt: null },
    });
    if (!target) throw new PartyError('TARGET_NOT_MEMBER');

    await this.prisma.$transaction(async (tx) => {
      await tx.partyMember.updateMany({
        where: {
          partyId: active.partyId,
          userId: callerUserId,
          leftAt: null,
        },
        data: { role: PrismaPartyRole.MEMBER },
      });
      await tx.partyMember.update({
        where: { id: target.id },
        data: { role: PrismaPartyRole.LEADER },
      });
      await tx.party.update({
        where: { id: active.partyId },
        data: { leaderUserId: targetUserId },
      });
    });

    const view = await this.loadPartyView(active.partyId);
    if (!view) throw new PartyError('NOT_FOUND');

    this.emitLeaderChanged(view.members, {
      partyId: active.partyId,
      previousLeaderUserId: callerUserId,
      newLeaderUserId: targetUserId,
    });
    this.emitPartyUpdated(view.party, view.members);
    return view;
  }

  /**
   * Disband party (chỉ leader). Mọi member active được set `leftAt`;
   * pending invite cancel.
   */
  async disbandParty(
    callerUserId: string,
  ): Promise<{ partyId: string }> {
    const active = await this.getActiveMembership(callerUserId);
    if (!active) throw new PartyError('NOT_MEMBER');
    const leaderUserId = await this.getLeaderUserId(active.partyId);
    if (!canDisbandParty({ actorUserId: callerUserId, leaderUserId })) {
      throw new PartyError('NOT_AUTHORIZED');
    }

    const partyId = active.partyId;
    const memberUserIdsBefore = (
      await this.prisma.partyMember.findMany({
        where: { partyId, leftAt: null },
        select: { userId: true },
      })
    ).map((m) => m.userId);

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.partyMember.updateMany({
        where: { partyId, leftAt: null },
        data: { leftAt: now },
      });
      await tx.party.update({
        where: { id: partyId },
        data: {
          status: PrismaPartyStatus.DISBANDED,
          disbandedAt: now,
        },
      });
      await tx.partyInvite.updateMany({
        where: { partyId, status: PrismaPartyInviteStatus.PENDING },
        data: {
          status: PrismaPartyInviteStatus.CANCELED,
          respondedAt: now,
        },
      });
    });

    // Fanout disband notice to all former members.
    this.emitPartyMemberLeft(memberUserIdsBefore, {
      partyId,
      userId: callerUserId,
      reason: 'DISBANDED',
    });
    return { partyId };
  }
}
