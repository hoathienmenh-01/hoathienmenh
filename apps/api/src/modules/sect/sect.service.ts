import { Injectable, Optional } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyError, CurrencyService } from '../character/currency.service';
import { MissionService } from '../mission/mission.service';
import { AchievementService } from '../character/achievement.service';

class SectError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'SECT_NOT_FOUND'
      | 'NOT_IN_SECT'
      | 'ALREADY_IN_SECT'
      | 'INVALID_AMOUNT'
      | 'INSUFFICIENT_LINH_THACH'
      | 'NAME_TAKEN'
      | 'INVALID_NAME'
      | 'NOT_LEADER'
      | 'NOT_ELDER_OR_LEADER'
      | 'CANNOT_KICK_SELF'
      | 'CANNOT_KICK_HIGHER_ROLE'
      | 'TARGET_NOT_IN_SECT'
      | 'ALREADY_LEADER',
  ) {
    super(code);
  }
}

export interface SectListView {
  id: string;
  name: string;
  description: string;
  level: number;
  treasuryLinhThach: string;
  memberCount: number;
  leaderName: string | null;
  createdAt: string;
}

export interface SectMemberView {
  id: string;
  name: string;
  realmKey: string;
  realmStage: number;
  congHien: number;
  role: 'LEADER' | 'ELDER' | 'MEMBER';
  isLeader: boolean;
  isMe: boolean;
}

export interface SectDetailView extends SectListView {
  members: SectMemberView[];
  isMyMember: boolean;
  isMyLeader: boolean;
}

const SECT_NAME_RE = /^[\p{L}\p{N} _-]{2,16}$/u;

@Injectable()
export class SectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly chars: CharacterService,
    private readonly currency: CurrencyService,
    private readonly missions: MissionService,
    @Optional() private readonly achievements?: AchievementService,
  ) {}

  async list(): Promise<SectListView[]> {
    const sects = await this.prisma.sect.findMany({
      orderBy: [{ level: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { characters: true } } },
    });
    if (sects.length === 0) return [];
    const leaderIds = sects.map((s) => s.leaderId).filter((x): x is string => !!x);
    const leaders = leaderIds.length
      ? await this.prisma.character.findMany({
          where: { id: { in: leaderIds } },
          select: { id: true, name: true },
        })
      : [];
    const leaderMap = new Map(leaders.map((l) => [l.id, l.name]));
    return sects.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      level: s.level,
      treasuryLinhThach: s.treasuryLinhThach.toString(),
      memberCount: s._count.characters,
      leaderName: s.leaderId ? (leaderMap.get(s.leaderId) ?? null) : null,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async detail(sectId: string, viewerCharId: string | null): Promise<SectDetailView> {
    const s = await this.prisma.sect.findUnique({
      where: { id: sectId },
      include: { _count: { select: { characters: true } } },
    });
    if (!s) throw new SectError('SECT_NOT_FOUND');

    // Read members from SectMember join table (role-aware).
    const memberRows = await this.prisma.sectMember.findMany({
      where: { sectId: s.id },
      include: {
        character: {
          select: { id: true, name: true, realmKey: true, realmStage: true, congHien: true },
        },
      },
      orderBy: [{ role: 'asc' }, { character: { congHien: 'desc' } }],
      take: 100,
    });

    const members: SectMemberView[] = memberRows.map((m) => ({
      id: m.character.id,
      name: m.character.name,
      realmKey: m.character.realmKey,
      realmStage: m.character.realmStage,
      congHien: m.character.congHien,
      role: m.role,
      isLeader: m.role === 'LEADER',
      isMe: m.character.id === viewerCharId,
    }));

    // Leader name for SectListView compat.
    const leaderName = s.leaderId
      ? (members.find((m) => m.id === s.leaderId)?.name ?? null)
      : null;

    // isMyMember — check in members first, fallback to DB (user may be outside top 100).
    let isMyMember = false;
    if (viewerCharId) {
      isMyMember = members.some((m) => m.id === viewerCharId);
      if (!isMyMember) {
        const cnt = await this.prisma.sectMember.count({
          where: { characterId: viewerCharId, sectId: s.id },
        });
        isMyMember = cnt > 0;
      }
    }

    return {
      id: s.id,
      name: s.name,
      description: s.description,
      level: s.level,
      treasuryLinhThach: s.treasuryLinhThach.toString(),
      memberCount: s._count.characters,
      leaderName,
      createdAt: s.createdAt.toISOString(),
      members,
      isMyMember,
      isMyLeader: viewerCharId ? viewerCharId === s.leaderId : false,
    };
  }

  async create(userId: string, name: string, description: string): Promise<SectDetailView> {
    if (!SECT_NAME_RE.test(name)) throw new SectError('INVALID_NAME');
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new SectError('NO_CHARACTER');
    if (char.sectId) throw new SectError('ALREADY_IN_SECT');

    let createdId: string;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const sect = await tx.sect.create({
          data: { name, description: description.slice(0, 200), leaderId: char.id },
        });
        const upd = await tx.character.updateMany({
          where: { id: char.id, sectId: null },
          data: { sectId: sect.id },
        });
        if (upd.count === 0) throw new SectError('ALREADY_IN_SECT');
        await tx.sectMember.create({
          data: { sectId: sect.id, characterId: char.id, role: 'LEADER' },
        });
        return sect;
      });
      createdId = created.id;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // P2002 có thể fire trên `name` (trùng tên) HOẶC `leaderId` (cùng
        // user lập 2 sect đồng thời). Tách 2 case bằng meta.target.
        const target = (e.meta?.target as string[] | undefined) ?? [];
        if (target.includes('leaderId')) throw new SectError('ALREADY_IN_SECT');
        throw new SectError('NAME_TAKEN');
      }
      throw e;
    }
    this.realtime.joinUserToRoom(userId, `sect:${createdId}`);
    await this.refreshState(userId);
    return this.detail(createdId, char.id);
  }

  async join(userId: string, sectId: string): Promise<SectDetailView> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new SectError('NO_CHARACTER');
    if (char.sectId) throw new SectError('ALREADY_IN_SECT');

    const sect = await this.prisma.sect.findUnique({ where: { id: sectId } });
    if (!sect) throw new SectError('SECT_NOT_FOUND');

    const upd = await this.prisma.character.updateMany({
      where: { id: char.id, sectId: null },
      data: { sectId: sect.id },
    });
    if (upd.count === 0) throw new SectError('ALREADY_IN_SECT');
    await this.prisma.sectMember.create({
      data: { sectId: sect.id, characterId: char.id, role: 'MEMBER' },
    });

    this.realtime.joinUserToRoom(userId, `sect:${sect.id}`);
    await this.refreshState(userId);
    return this.detail(sect.id, char.id);
  }

  async leave(userId: string): Promise<{ ok: true }> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new SectError('NO_CHARACTER');
    if (!char.sectId) throw new SectError('NOT_IN_SECT');
    const oldSectId = char.sectId;

    // Capture role before delete for audit log.
    const memberRow = await this.prisma.sectMember.findUnique({
      where: { characterId: char.id },
      select: { role: true },
    });

    await this.prisma.$transaction(async (tx) => {
      // Leader rời tông → bỏ leader, sect tồn tại đến khi admin xử lý.
      const sect = await tx.sect.findUnique({ where: { id: oldSectId } });
      if (sect?.leaderId === char.id) {
        await tx.sect.update({
          where: { id: oldSectId },
          data: { leaderId: null },
        });
      }
      // Delete SectMember row first (has FK to character).
      await tx.sectMember.deleteMany({
        where: { characterId: char.id, sectId: oldSectId },
      });
      // Optimistic lock: chỉ rời nếu user vẫn thuộc oldSectId (chống race
      // với leave/join concurrent từ session khác của cùng user).
      const left = await tx.character.updateMany({
        where: { id: char.id, sectId: oldSectId },
        data: { sectId: null },
      });
      if (left.count === 0) throw new SectError('NOT_IN_SECT');
      await this.logAuditTx(tx, oldSectId, char.id, char.id, 'LEAVE', memberRow?.role ?? null, null);
    });

    this.realtime.leaveUserFromRoom(userId, `sect:${oldSectId}`);
    await this.refreshState(userId);
    return { ok: true };
  }

  async contribute(userId: string, amount: bigint): Promise<SectDetailView> {
    if (amount <= 0n) throw new SectError('INVALID_AMOUNT');
    // Cap 1M/lượt để tránh overflow Int của congHien — reject thẳng để
    // không trừ linh thạch quá tay mà chỉ cộng cống hiến cap.
    if (amount > 1_000_000n) throw new SectError('INVALID_AMOUNT');
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new SectError('NO_CHARACTER');
    if (!char.sectId) throw new SectError('NOT_IN_SECT');
    const sectId = char.sectId;

    // 1 linhThach → 1 điểm cống hiến.
    const congHienGain = Number(amount);

    await this.prisma.$transaction(async (tx) => {
      // Trừ linh thạch + ghi ledger; guard sectId để chống race với leave().
      try {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.LINH_THACH,
          delta: -amount,
          reason: 'SECT_CONTRIBUTE',
          refType: 'Sect',
          refId: sectId,
          extraWhere: { sectId },
          meta: { congHienGain },
        });
      } catch (e) {
        if (e instanceof CurrencyError && e.code === 'INSUFFICIENT_FUNDS') {
          // Phân biệt 2 lý do: nếu sect đã đổi → NOT_IN_SECT, không thì
          // thực sự thiếu linh thạch.
          const cur = await tx.character.findUnique({
            where: { id: char.id },
            select: { sectId: true },
          });
          if (cur?.sectId !== sectId) throw new SectError('NOT_IN_SECT');
          throw new SectError('INSUFFICIENT_LINH_THACH');
        }
        throw e;
      }
      await tx.character.update({
        where: { id: char.id },
        data: { congHien: { increment: congHienGain } },
      });
      await tx.sect.update({
        where: { id: sectId },
        data: { treasuryLinhThach: { increment: amount } },
      });
    });

    await this.refreshState(userId);
    // Phase 11.10.C-2 wire trackEvent vào achievement bằng cùng goalKind
    // SECT_CONTRIBUTE. Fail-soft: contribute đã thành công + ledger committed,
    // nên không rollback nếu mission/achievement lỗi.
    try {
      await this.missions.track(char.id, 'SECT_CONTRIBUTE', Number(amount));
      if (this.achievements) {
        await this.achievements.trackEvent(
          char.id,
          'SECT_CONTRIBUTE',
          Number(amount),
        );
      }
    } catch {
      // bỏ qua lỗi mission/achievement — contribute đã thành công.
    }
    return this.detail(sectId, char.id);
  }

  async promote(userId: string, targetCharacterId: string): Promise<SectDetailView> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new SectError('NO_CHARACTER');
    if (!char.sectId) throw new SectError('NOT_IN_SECT');
    const sectId = char.sectId;

    const actorMember = await this.prisma.sectMember.findUnique({
      where: { characterId: char.id },
    });
    if (!actorMember || actorMember.sectId !== sectId) throw new SectError('NOT_IN_SECT');
    if (actorMember.role !== 'LEADER') throw new SectError('NOT_LEADER');

    const targetMember = await this.prisma.sectMember.findUnique({
      where: { characterId: targetCharacterId },
    });
    if (!targetMember || targetMember.sectId !== sectId) throw new SectError('TARGET_NOT_IN_SECT');
    if (targetMember.role === 'LEADER') throw new SectError('ALREADY_LEADER');

    await this.prisma.$transaction(async (tx) => {
      if (targetMember.role === 'MEMBER') {
        // MEMBER → ELDER
        await tx.sectMember.update({
          where: { characterId: targetCharacterId },
          data: { role: 'ELDER' },
        });
        await this.logAuditTx(tx, sectId, char.id, targetCharacterId, 'PROMOTE', 'MEMBER', 'ELDER');
      } else {
        // ELDER → LEADER: demote current leader to ELDER, promote target to LEADER
        await tx.sectMember.update({
          where: { characterId: char.id },
          data: { role: 'ELDER' },
        });
        await tx.sectMember.update({
          where: { characterId: targetCharacterId },
          data: { role: 'LEADER' },
        });
        await tx.sect.update({
          where: { id: sectId },
          data: { leaderId: targetCharacterId },
        });
        await this.logAuditTx(tx, sectId, char.id, targetCharacterId, 'PROMOTE', 'ELDER', 'LEADER');
      }
    });

    await this.refreshState(userId);
    return this.detail(sectId, char.id);
  }

  async demote(userId: string, targetCharacterId: string): Promise<SectDetailView> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new SectError('NO_CHARACTER');
    if (!char.sectId) throw new SectError('NOT_IN_SECT');
    const sectId = char.sectId;

    const actorMember = await this.prisma.sectMember.findUnique({
      where: { characterId: char.id },
    });
    if (!actorMember || actorMember.sectId !== sectId) throw new SectError('NOT_IN_SECT');
    if (actorMember.role !== 'LEADER') throw new SectError('NOT_LEADER');

    const targetMember = await this.prisma.sectMember.findUnique({
      where: { characterId: targetCharacterId },
    });
    if (!targetMember || targetMember.sectId !== sectId) throw new SectError('TARGET_NOT_IN_SECT');
    if (targetMember.role !== 'ELDER') throw new SectError('TARGET_NOT_IN_SECT');

    await this.prisma.$transaction(async (tx) => {
      await tx.sectMember.update({
        where: { characterId: targetCharacterId },
        data: { role: 'MEMBER' },
      });
      await this.logAuditTx(tx, sectId, char.id, targetCharacterId, 'DEMOTE', 'ELDER', 'MEMBER');
    });

    await this.refreshState(userId);
    return this.detail(sectId, char.id);
  }

  async kick(userId: string, targetCharacterId: string): Promise<{ ok: true }> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new SectError('NO_CHARACTER');
    if (!char.sectId) throw new SectError('NOT_IN_SECT');
    if (char.id === targetCharacterId) throw new SectError('CANNOT_KICK_SELF');
    const sectId = char.sectId;

    const actorMember = await this.prisma.sectMember.findUnique({
      where: { characterId: char.id },
    });
    if (!actorMember || actorMember.sectId !== sectId) throw new SectError('NOT_IN_SECT');
    if (actorMember.role !== 'LEADER' && actorMember.role !== 'ELDER') {
      throw new SectError('NOT_ELDER_OR_LEADER');
    }

    const targetMember = await this.prisma.sectMember.findUnique({
      where: { characterId: targetCharacterId },
    });
    if (!targetMember || targetMember.sectId !== sectId) throw new SectError('TARGET_NOT_IN_SECT');

    // ELDER can only kick MEMBER; LEADER can kick anyone.
    if (actorMember.role === 'ELDER' && targetMember.role !== 'MEMBER') {
      throw new SectError('CANNOT_KICK_HIGHER_ROLE');
    }

    const targetUserId = await this.prisma.character.findUnique({
      where: { id: targetCharacterId },
      select: { userId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.sectMember.deleteMany({
        where: { characterId: targetCharacterId, sectId },
      });
      // If target was leader (edge case), clear leaderId.
      if (targetMember.role === 'LEADER') {
        await tx.sect.update({ where: { id: sectId }, data: { leaderId: null } });
      }
      await tx.character.updateMany({
        where: { id: targetCharacterId, sectId },
        data: { sectId: null },
      });
      await this.logAuditTx(tx, sectId, char.id, targetCharacterId, 'KICK', targetMember.role, null);
    });

    if (targetUserId) {
      this.realtime.leaveUserFromRoom(targetUserId.userId, `sect:${sectId}`);
      await this.refreshState(targetUserId.userId);
    }
    await this.refreshState(userId);
    return { ok: true };
  }

  private async logAuditTx(
    tx: Prisma.TransactionClient,
    sectId: string,
    actorCharId: string,
    targetCharId: string,
    action: string,
    fromRole: string | null,
    toRole: string | null,
  ): Promise<void> {
    try {
      await tx.sectAuditLog.create({
        data: {
          sectId,
          actorCharId,
          targetCharId,
          action,
          fromRole: fromRole as never,
          toRole: toRole as never,
        },
      });
    } catch {
      // Fire-and-forget: audit failure must not block the mutation.
    }
  }

  private async refreshState(userId: string): Promise<void> {
    const state = await this.chars.findByUser(userId);
    if (state) this.realtime.emitToUser(userId, 'state:update', state);
  }
}

export { SectError };
