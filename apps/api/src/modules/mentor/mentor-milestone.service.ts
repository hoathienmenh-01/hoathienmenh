import { Injectable } from '@nestjs/common';
import {
  MENTOR_MILESTONES,
  MENTOR_MILESTONE_ROLES,
  getMentorMilestoneReward,
  mentorMilestoneByKey,
  mentorMilestonesEarnedAt,
  realmByKey,
  type MentorMilestoneListResponse,
  type MentorMilestoneProgressRow,
  type MentorMilestoneRole,
  type MentorMilestoneStatus,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Phase 35.2 — Mentor Milestone reward service.
 *
 * Extends Phase 31.0 `MentorService` foundation:
 * - Lazy-create `MentorMilestoneProgress` rows cho mọi milestone trong catalog
 *   khi user gọi list lần đầu cho relation ACTIVE.
 * - Recompute `LOCKED → AVAILABLE` dựa trên realmKey hiện tại của disciple.
 * - Atomic claim qua `$transaction`: CAS `MentorMilestoneProgress.status = CLAIMED`
 *   (cho per-role tracking thực tế lưu ở `MentorRewardClaim` UNIQUE (relationId,
 *   milestoneKey, role)) + send mail SYSTEM với linh thạch reward.
 * - Mỗi role (MENTOR/DISCIPLE) claim độc lập 1 lần.
 *
 * Anti-abuse:
 * - Chỉ claim được khi relation ACTIVE.
 * - Disciple phải đạt realm THẬT (server đọc `Character.realmKey`).
 * - UNIQUE constraint (relationId, milestoneKey, role) chống double-claim.
 * - Reward linh thạch only — KHÔNG mint Tiên Ngọc / item endgame.
 */
export class MentorMilestoneError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'NOT_FOUND'
      | 'NOT_AUTHORIZED'
      | 'NOT_IN_ACTIVE_RELATION'
      | 'MILESTONE_NOT_FOUND'
      | 'MILESTONE_LOCKED'
      | 'MILESTONE_ALREADY_CLAIMED',
  ) {
    super(code);
  }
}

interface CharacterCtx {
  characterId: string;
  realmKey: string;
  realmOrder: number;
  displayName: string | null;
}

@Injectable()
export class MentorMilestoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private async charCtx(userId: string): Promise<CharacterCtx> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true, name: true },
    });
    if (!c) throw new MentorMilestoneError('NO_CHARACTER');
    const order = realmByKey(c.realmKey)?.order ?? 0;
    return {
      characterId: c.id,
      realmKey: c.realmKey,
      realmOrder: order,
      displayName: c.name,
    };
  }

  /**
   * Lazy-create `MentorMilestoneProgress` row cho mọi milestone trong catalog
   * mà chưa có row cho relation này. Flip LOCKED → AVAILABLE nếu disciple đạt
   * order. Idempotent — KHÔNG flip về LOCKED nếu disciple downgrade.
   *
   * Return số row được create + số row được flip.
   */
  async recomputeForRelation(
    mentorRelationId: string,
  ): Promise<{ created: number; promoted: number }> {
    const rel = await this.prisma.mentorRelation.findUnique({
      where: { id: mentorRelationId },
    });
    if (!rel) throw new MentorMilestoneError('NOT_FOUND');
    if (rel.status !== 'ACTIVE') {
      throw new MentorMilestoneError('NOT_IN_ACTIVE_RELATION');
    }
    const discipleChar = await this.prisma.character.findUnique({
      where: { userId: rel.studentUserId },
      select: { realmKey: true },
    });
    const discipleOrder = discipleChar
      ? (realmByKey(discipleChar.realmKey)?.order ?? 0)
      : 0;

    const existing = await this.prisma.mentorMilestoneProgress.findMany({
      where: { mentorRelationId },
      select: { id: true, milestoneKey: true, status: true, reachedAt: true },
    });
    const existingByKey = new Map(existing.map((r) => [r.milestoneKey, r]));

    let created = 0;
    let promoted = 0;
    const now = new Date();

    for (const def of MENTOR_MILESTONES) {
      const earned = discipleOrder >= def.requiredRealmOrder;
      const row = existingByKey.get(def.milestoneKey);
      if (!row) {
        await this.prisma.mentorMilestoneProgress.create({
          data: {
            mentorRelationId,
            mentorUserId: rel.mentorUserId,
            studentUserId: rel.studentUserId,
            milestoneKey: def.milestoneKey,
            status: earned ? 'AVAILABLE' : 'LOCKED',
            reachedAt: earned ? now : null,
          },
        });
        created += 1;
        if (earned) promoted += 1;
        continue;
      }
      if (row.status === 'LOCKED' && earned) {
        const upd = await this.prisma.mentorMilestoneProgress.updateMany({
          where: { id: row.id, status: 'LOCKED' },
          data: { status: 'AVAILABLE', reachedAt: now },
        });
        if (upd.count === 1) promoted += 1;
      }
    }
    return { created, promoted };
  }

  async listForUser(userId: string): Promise<MentorMilestoneListResponse> {
    const asMentorRels = await this.prisma.mentorRelation.findMany({
      where: { mentorUserId: userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    const asDiscipleRel = await this.prisma.mentorRelation.findFirst({
      where: { studentUserId: userId, status: 'ACTIVE' },
    });

    for (const rel of asMentorRels) {
      await this.recomputeForRelation(rel.id);
    }
    if (asDiscipleRel) {
      await this.recomputeForRelation(asDiscipleRel.id);
    }

    const asMentor = await Promise.all(
      asMentorRels.map(async (rel) => {
        const studentChar = await this.prisma.character.findUnique({
          where: { userId: rel.studentUserId },
          select: { realmKey: true, name: true },
        });
        const studentOrder = studentChar
          ? (realmByKey(studentChar.realmKey)?.order ?? 0)
          : 0;
        const progress = await this.collectProgress(rel.id, 'MENTOR');
        return {
          relationId: rel.id,
          studentUserId: rel.studentUserId,
          studentDisplayName: studentChar?.name ?? rel.studentDisplayName ?? null,
          studentRealmKey: studentChar?.realmKey ?? 'phamnhan',
          studentRealmOrder: studentOrder,
          progress,
        };
      }),
    );

    let asDisciple: MentorMilestoneListResponse['asDisciple'] = null;
    if (asDiscipleRel) {
      const selfChar = await this.prisma.character.findUnique({
        where: { userId },
        select: { realmKey: true },
      });
      const selfOrder = selfChar
        ? (realmByKey(selfChar.realmKey)?.order ?? 0)
        : 0;
      const progress = await this.collectProgress(asDiscipleRel.id, 'DISCIPLE');
      asDisciple = {
        relationId: asDiscipleRel.id,
        mentorUserId: asDiscipleRel.mentorUserId,
        mentorDisplayName: asDiscipleRel.mentorDisplayName ?? null,
        selfRealmKey: selfChar?.realmKey ?? 'phamnhan',
        selfRealmOrder: selfOrder,
        progress,
      };
    }

    return { asMentor, asDisciple };
  }

  private async collectProgress(
    mentorRelationId: string,
    viewerRole: MentorMilestoneRole,
  ): Promise<readonly MentorMilestoneProgressRow[]> {
    const progressRows = await this.prisma.mentorMilestoneProgress.findMany({
      where: { mentorRelationId },
      orderBy: { createdAt: 'asc' },
    });
    const claimedRoleSet = new Set(
      (
        await this.prisma.mentorRewardClaim.findMany({
          where: { mentorRelationId, role: viewerRole },
          select: { milestoneKey: true },
        })
      ).map((c) => c.milestoneKey),
    );
    const out: MentorMilestoneProgressRow[] = [];
    for (const def of MENTOR_MILESTONES) {
      const row = progressRows.find((r) => r.milestoneKey === def.milestoneKey);
      const status: MentorMilestoneStatus =
        (row?.status as MentorMilestoneStatus | undefined) ?? 'LOCKED';
      out.push({
        milestoneKey: def.milestoneKey,
        status,
        reachedAt: row?.reachedAt ? row.reachedAt.toISOString() : null,
        titleVi: def.titleVi,
        titleEn: def.titleEn,
        viewerRewardLinhThach: (viewerRole === 'MENTOR'
          ? def.mentorRewardLinhThach
          : def.discipleRewardLinhThach
        ).toString(),
        viewerClaimed: claimedRoleSet.has(def.milestoneKey),
      });
    }
    return out;
  }

  /**
   * Atomic claim cho 1 milestone — server resolves role từ user ID match với
   * relation ACTIVE (MENTOR hoặc DISCIPLE). Reward gửi qua mail SYSTEM.
   */
  async claim(
    userId: string,
    milestoneKey: string,
  ): Promise<{
    role: MentorMilestoneRole;
    rewardLinhThach: string;
    mailId: string;
  }> {
    const def = mentorMilestoneByKey(milestoneKey);
    if (!def) throw new MentorMilestoneError('MILESTONE_NOT_FOUND');

    const rel = await this.prisma.mentorRelation.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [{ mentorUserId: userId }, { studentUserId: userId }],
      },
      orderBy: { respondedAt: 'desc' },
    });
    if (!rel) throw new MentorMilestoneError('NOT_IN_ACTIVE_RELATION');

    const role: MentorMilestoneRole =
      rel.mentorUserId === userId ? 'MENTOR' : 'DISCIPLE';

    // Ensure progress row exists + reflect current disciple realm.
    await this.recomputeForRelation(rel.id);

    const progress = await this.prisma.mentorMilestoneProgress.findUnique({
      where: {
        mentorRelationId_milestoneKey: {
          mentorRelationId: rel.id,
          milestoneKey,
        },
      },
    });
    if (!progress || progress.status === 'LOCKED') {
      throw new MentorMilestoneError('MILESTONE_LOCKED');
    }

    // Idempotent guard via UNIQUE (relationId, milestoneKey, role).
    const existingClaim = await this.prisma.mentorRewardClaim.findUnique({
      where: {
        mentorRelationId_milestoneKey_role: {
          mentorRelationId: rel.id,
          milestoneKey,
          role,
        },
      },
    });
    if (existingClaim) {
      throw new MentorMilestoneError('MILESTONE_ALREADY_CLAIMED');
    }

    const claimerChar = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, name: true },
    });
    if (!claimerChar) throw new MentorMilestoneError('NO_CHARACTER');

    const rewardLT = getMentorMilestoneReward(milestoneKey, role);

    // Atomic: insert claim row → create mail → patch claim with mailId → flip
    // progress status to CLAIMED if both roles claimed (best-effort cosmetic
    // flip; UNIQUE constraint above is the real anti-double-claim guard).
    return await this.prisma.$transaction(async (tx) => {
      const claim = await tx.mentorRewardClaim.create({
        data: {
          mentorRelationId: rel.id,
          milestoneKey,
          claimerUserId: userId,
          role,
          rewardSnapshotJson: {
            milestoneKey,
            role,
            linhThach: rewardLT.toString(),
            titleVi: def.titleVi,
            titleEn: def.titleEn,
          },
        },
      });

      const mailView = await this.mail.sendToCharacter({
        recipientCharacterId: claimerChar.id,
        senderName: 'Thiên Đạo Sứ Giả',
        subject:
          role === 'MENTOR'
            ? `Sư phụ thưởng — ${def.titleVi}`
            : `Đồ đệ tinh tiến — ${def.titleVi}`,
        body:
          role === 'MENTOR'
            ? `Đồ đệ của ngươi đã đạt cảnh giới ${def.titleVi}. Nhận thưởng sư đồ.`
            : `Ngươi đã đạt cảnh giới ${def.titleVi}. Sư phụ vui mừng ban thưởng.`,
        rewardLinhThach: rewardLT,
        rewardTienNgoc: 0,
        rewardExp: 0n,
        rewardItems: [],
        mailType: 'SYSTEM',
      });

      await tx.mentorRewardClaim.update({
        where: { id: claim.id },
        data: { mailId: mailView.id },
      });

      // Cosmetic: nếu cả 2 role đã claim, flip progress.status → CLAIMED.
      const claimCount = await tx.mentorRewardClaim.count({
        where: { mentorRelationId: rel.id, milestoneKey },
      });
      if (claimCount >= MENTOR_MILESTONE_ROLES.length) {
        await tx.mentorMilestoneProgress.updateMany({
          where: {
            mentorRelationId: rel.id,
            milestoneKey,
            status: 'AVAILABLE',
          },
          data: { status: 'CLAIMED' },
        });
      }

      return {
        role,
        rewardLinhThach: rewardLT.toString(),
        mailId: mailView.id,
      };
    });
  }

  /**
   * Convenience: recompute progress cho relation ACTIVE viewer là member.
   * Returns null nếu user không có relation ACTIVE.
   */
  async recomputeForUser(
    userId: string,
  ): Promise<{ relationId: string; created: number; promoted: number } | null> {
    const rel = await this.prisma.mentorRelation.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [{ mentorUserId: userId }, { studentUserId: userId }],
      },
      orderBy: { respondedAt: 'desc' },
    });
    if (!rel) return null;
    const r = await this.recomputeForRelation(rel.id);
    return { relationId: rel.id, ...r };
  }

  /** Public for test convenience — earned milestone list for given realm order. */
  earnedMilestonesFor(realmOrder: number): readonly string[] {
    return mentorMilestonesEarnedAt(realmOrder);
  }
}
