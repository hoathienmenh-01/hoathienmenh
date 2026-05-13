import { Injectable } from '@nestjs/common';
import {
  MENTOR_LIMITS,
  MENTOR_RELATION_STATUSES,
  realmByKey,
  sanitizeMentorIntro,
  sanitizeMentorRequestMessage,
  validateMentorRequest,
  type MentorListStudentsResponse,
  type MentorProfileRow,
  type MentorRelationRow,
  type MentorRelationStatus,
  type StudentMentorContextResponse,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 31.0 — Mentor / Sư đồ foundation service.
 *
 * Anti-abuse:
 *   - mentor phải `realmTier >= MENTOR_LIMITS.MIN_MENTOR_REALM_TIER`
 *   - student phải `realmTier <= MENTOR_LIMITS.MAX_STUDENT_REALM_TIER`
 *   - gap (mentor.tier - student.tier) >= `MENTOR_LIMITS.MIN_TIER_GAP`
 *   - mentor không quá `MENTOR_STUDENT_MAX` đồ đệ ACTIVE
 *   - student không quá `STUDENT_PENDING_REQUEST_MAX` request PENDING
 *   - student chưa có mentor ACTIVE khác
 *   - không tự bái sư chính mình
 *   - mentor phải đăng ký + acceptingStudents = true
 *
 * Foundation ONLY — Phase 31 KHÔNG mint reward tự động cho mentor/student.
 */
export class MentorError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'NOT_FOUND'
      | 'NOT_AUTHORIZED'
      | 'NOT_MENTOR'
      | 'NOT_STUDENT'
      | 'TIER_TOO_LOW'
      | 'TIER_TOO_HIGH'
      | 'TIER_GAP_TOO_SMALL'
      | 'STUDENT_ALREADY_HAS_MENTOR'
      | 'MENTOR_STUDENT_CAP_REACHED'
      | 'PENDING_REQUEST_CAP_REACHED'
      | 'ALREADY_PENDING'
      | 'ALREADY_ACTIVE'
      | 'INVALID_TRANSITION'
      | 'INVALID_INPUT'
      | 'SELF_NOT_ALLOWED',
  ) {
    super(code);
  }
}

export interface MentorRegisterInput {
  intro?: string | null;
  acceptingStudents?: boolean;
}

export interface MentorRequestPayload {
  mentorUserId: string;
  message?: string | null;
}

@Injectable()
export class MentorService {
  constructor(private readonly prisma: PrismaService) {}

  private async tierOf(userId: string): Promise<{
    characterId: string;
    realmTier: number;
    displayName: string | null;
  }> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true, name: true },
    });
    if (!c) throw new MentorError('NO_CHARACTER');
    const tier = realmByKey(c.realmKey)?.order ?? 0;
    return { characterId: c.id, realmTier: tier, displayName: c.name };
  }

  async getProfile(userId: string): Promise<MentorProfileRow | null> {
    const row = await this.prisma.mentorProfile.findUnique({
      where: { mentorUserId: userId },
    });
    if (!row) return null;
    return toProfileRow(row);
  }

  /** Đăng ký làm mentor. Idempotent: nếu đã có profile thì update. */
  async register(
    userId: string,
    input: MentorRegisterInput,
  ): Promise<MentorProfileRow> {
    const { realmTier, displayName } = await this.tierOf(userId);
    if (realmTier < MENTOR_LIMITS.MIN_MENTOR_REALM_TIER) {
      throw new MentorError('TIER_TOO_LOW');
    }
    const intro = sanitizeMentorIntro(input.intro ?? null);
    const accepting = input.acceptingStudents ?? true;

    const row = await this.prisma.mentorProfile.upsert({
      where: { mentorUserId: userId },
      create: {
        mentorUserId: userId,
        displayName,
        realmTier,
        intro,
        acceptingStudents: accepting,
        activeStudentCount: 0,
      },
      update: {
        realmTier,
        intro,
        acceptingStudents: accepting,
        displayName,
      },
    });
    return toProfileRow(row);
  }

  /** Student gửi yêu cầu bái sư. */
  async request(
    studentUserId: string,
    input: MentorRequestPayload,
  ): Promise<MentorRelationRow> {
    if (input.mentorUserId === studentUserId) {
      throw new MentorError('SELF_NOT_ALLOWED');
    }
    const student = await this.tierOf(studentUserId);

    const mentorProfile = await this.prisma.mentorProfile.findUnique({
      where: { mentorUserId: input.mentorUserId },
    });
    if (!mentorProfile) throw new MentorError('NOT_MENTOR');

    const studentPending = await this.prisma.mentorRelation.count({
      where: {
        studentUserId,
        status: MENTOR_RELATION_STATUSES[0],
      },
    });
    const studentHasActive = await this.prisma.mentorRelation.findFirst({
      where: { studentUserId, status: MENTOR_RELATION_STATUSES[1] },
      select: { id: true },
    });

    const err = validateMentorRequest({
      mentorRealmTier: mentorProfile.realmTier,
      studentRealmTier: student.realmTier,
      studentPendingRequests: studentPending,
      mentorActiveStudents: mentorProfile.activeStudentCount,
      mentorAcceptingStudents: mentorProfile.acceptingStudents,
      studentAlreadyHasActiveMentor: !!studentHasActive,
    });
    if (err) throw new MentorError(err as MentorError['code']);

    // Idempotent duplicate check between same pair
    const existing = await this.prisma.mentorRelation.findFirst({
      where: {
        mentorUserId: input.mentorUserId,
        studentUserId,
        status: { in: [MENTOR_RELATION_STATUSES[0], MENTOR_RELATION_STATUSES[1]] },
      },
    });
    if (existing) {
      throw new MentorError(
        existing.status === MENTOR_RELATION_STATUSES[1]
          ? 'ALREADY_ACTIVE'
          : 'ALREADY_PENDING',
      );
    }

    const sanitized = sanitizeMentorRequestMessage(input.message ?? null);
    const row = await this.prisma.mentorRelation.create({
      data: {
        mentorUserId: input.mentorUserId,
        studentUserId,
        status: MENTOR_RELATION_STATUSES[0],
        message: sanitized,
        mentorDisplayName: mentorProfile.displayName ?? null,
        studentDisplayName: student.displayName,
      },
    });
    return toRelationRow(row);
  }

  /** Mentor accept / decline pending. CAS trên `status=PENDING`. */
  async respond(
    mentorUserId: string,
    relationId: string,
    accept: boolean,
  ): Promise<MentorRelationRow> {
    const rel = await this.prisma.mentorRelation.findUnique({
      where: { id: relationId },
    });
    if (!rel) throw new MentorError('NOT_FOUND');
    if (rel.mentorUserId !== mentorUserId) {
      throw new MentorError('NOT_AUTHORIZED');
    }
    if (rel.status !== MENTOR_RELATION_STATUSES[0]) {
      throw new MentorError('INVALID_TRANSITION');
    }

    if (accept) {
      await this.prisma.$transaction(async (tx) => {
        const profile = await tx.mentorProfile.findUnique({
          where: { mentorUserId },
        });
        if (!profile) throw new MentorError('NOT_MENTOR');
        if (profile.activeStudentCount >= MENTOR_LIMITS.MENTOR_STUDENT_MAX) {
          throw new MentorError('MENTOR_STUDENT_CAP_REACHED');
        }
        const studentHasActive = await tx.mentorRelation.findFirst({
          where: {
            studentUserId: rel.studentUserId,
            status: MENTOR_RELATION_STATUSES[1],
          },
          select: { id: true },
        });
        if (studentHasActive) {
          throw new MentorError('STUDENT_ALREADY_HAS_MENTOR');
        }
        const upd = await tx.mentorRelation.updateMany({
          where: { id: relationId, status: MENTOR_RELATION_STATUSES[0] },
          data: {
            status: MENTOR_RELATION_STATUSES[1],
            respondedAt: new Date(),
          },
        });
        if (upd.count !== 1) throw new MentorError('INVALID_TRANSITION');
        await tx.mentorProfile.update({
          where: { mentorUserId },
          data: { activeStudentCount: { increment: 1 } },
        });
      });
    } else {
      const upd = await this.prisma.mentorRelation.updateMany({
        where: { id: relationId, status: MENTOR_RELATION_STATUSES[0] },
        data: {
          status: MENTOR_RELATION_STATUSES[2],
          respondedAt: new Date(),
        },
      });
      if (upd.count !== 1) throw new MentorError('INVALID_TRANSITION');
    }

    const updated = await this.prisma.mentorRelation.findUniqueOrThrow({
      where: { id: relationId },
    });
    return toRelationRow(updated);
  }

  /** Mentor view: tất cả student + pending request. */
  async listStudents(mentorUserId: string): Promise<MentorListStudentsResponse> {
    const [students, pending] = await Promise.all([
      this.prisma.mentorRelation.findMany({
        where: {
          mentorUserId,
          status: { in: [MENTOR_RELATION_STATUSES[1], MENTOR_RELATION_STATUSES[3]] },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.mentorRelation.findMany({
        where: { mentorUserId, status: MENTOR_RELATION_STATUSES[0] },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      students: students.map(toRelationRow),
      pending: pending.map(toRelationRow),
    };
  }

  /** Student view: mentor đang ACTIVE + các pending request đang gửi đi. */
  async getStudentContext(
    studentUserId: string,
  ): Promise<StudentMentorContextResponse> {
    const [mentor, pending] = await Promise.all([
      this.prisma.mentorRelation.findFirst({
        where: { studentUserId, status: MENTOR_RELATION_STATUSES[1] },
        orderBy: { respondedAt: 'desc' },
      }),
      this.prisma.mentorRelation.findMany({
        where: { studentUserId, status: MENTOR_RELATION_STATUSES[0] },
        orderBy: { createdAt: 'desc' },
        take: MENTOR_LIMITS.STUDENT_PENDING_REQUEST_MAX,
      }),
    ]);
    return {
      mentor: mentor ? toRelationRow(mentor) : null,
      pending: pending.map(toRelationRow),
    };
  }
}

function toProfileRow(row: {
  mentorUserId: string;
  displayName: string | null;
  realmTier: number;
  intro: string | null;
  acceptingStudents: boolean;
  activeStudentCount: number;
  createdAt: Date;
  updatedAt: Date;
}): MentorProfileRow {
  return {
    mentorUserId: row.mentorUserId,
    displayName: row.displayName,
    realmTier: row.realmTier,
    intro: row.intro,
    acceptingStudents: row.acceptingStudents,
    activeStudentCount: row.activeStudentCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRelationRow(row: {
  id: string;
  mentorUserId: string;
  studentUserId: string;
  status: string;
  message: string | null;
  mentorDisplayName: string | null;
  studentDisplayName: string | null;
  createdAt: Date;
  respondedAt: Date | null;
  endedAt: Date | null;
}): MentorRelationRow {
  return {
    id: row.id,
    mentorUserId: row.mentorUserId,
    studentUserId: row.studentUserId,
    status: row.status as MentorRelationStatus,
    message: row.message,
    mentorDisplayName: row.mentorDisplayName,
    studentDisplayName: row.studentDisplayName,
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}
