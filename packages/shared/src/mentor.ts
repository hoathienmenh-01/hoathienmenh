/**
 * Phase 31.0 — Mentor / Sư-Đồ foundation.
 *
 * Foundation phase: cho phép người chơi cao cảnh giới đăng ký làm
 * `mentor` và nhận được nhiều `student`. Reward lớn / referral / quà
 * chu kỳ là OUT-OF-SCOPE Phase 31 — đẩy phase sau.
 *
 * Anti-abuse:
 *   - Mentor và Student phải khác user (no self).
 *   - Mỗi student chỉ có MAX 1 mentor đang `ACTIVE`.
 *   - Mỗi mentor có cap số student (config).
 *   - `mentorRealmTier >= MIN_MENTOR_REALM_TIER` (mặc định 9 — Kim Đan).
 *   - `studentRealmTier <= MAX_STUDENT_REALM_TIER` (mặc định 6 — Trúc Cơ).
 *   - Mentor và student chênh lệch tier ≥ `MIN_TIER_GAP` để chống farm
 *     account phụ (alt + main cùng tier).
 *   - Reward sư-đồ Phase 31: KHÔNG có. Chỉ track quan hệ.
 */

export const MENTOR_RELATION_STATUSES = [
  /** Yêu cầu bái sư từ student, chờ mentor accept/decline. */
  'PENDING',
  /** Mentor đã accept — quan hệ đang hoạt động. */
  'ACTIVE',
  /** Mentor từ chối hoặc student rút yêu cầu. */
  'DECLINED',
  /** Quan hệ đã kết thúc (mentor hoặc student kết thúc / mất quyền). */
  'ENDED',
] as const;
export type MentorRelationStatus = (typeof MENTOR_RELATION_STATUSES)[number];

export function isMentorRelationStatus(v: unknown): v is MentorRelationStatus {
  return (
    typeof v === 'string' &&
    (MENTOR_RELATION_STATUSES as readonly string[]).includes(v)
  );
}

export const MENTOR_LIMITS = {
  /** Mentor RealmTier tối thiểu để đăng ký làm mentor. */
  MIN_MENTOR_REALM_TIER: 9,
  /** Student RealmTier tối đa được phép gửi yêu cầu bái sư. */
  MAX_STUDENT_REALM_TIER: 6,
  /** Chênh lệch tối thiểu giữa mentor và student (chống alt-acc). */
  MIN_TIER_GAP: 3,
  /** Số student đồng thời (ACTIVE) tối đa cho 1 mentor. */
  MENTOR_STUDENT_MAX: 5,
  /** Số yêu cầu PENDING tối đa của 1 student tại 1 thời điểm. */
  STUDENT_PENDING_REQUEST_MAX: 3,
  /** Cap text intro mentor profile. */
  MENTOR_INTRO_MAX: 280,
  /** Cap text message gửi kèm yêu cầu bái sư. */
  REQUEST_MESSAGE_MAX: 240,
  /** Daily cap thao tác mentor-related (anti-abuse). */
  DAILY_RELATION_OPS_MAX: 20,
} as const;

export type MentorErrorCode =
  | 'SELF_NOT_ALLOWED'
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
  | 'DAILY_OPS_CAP_REACHED';

export interface MentorProfileRow {
  mentorUserId: string;
  displayName: string | null;
  realmTier: number;
  intro: string | null;
  acceptingStudents: boolean;
  /** Số học trò ACTIVE hiện có. */
  activeStudentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MentorRelationRow {
  id: string;
  mentorUserId: string;
  studentUserId: string;
  status: MentorRelationStatus;
  message: string | null;
  mentorDisplayName: string | null;
  studentDisplayName: string | null;
  createdAt: string;
  respondedAt: string | null;
  endedAt: string | null;
}

export interface MentorListStudentsResponse {
  students: MentorRelationRow[];
  /** Pending requests sent TO mentor (chờ mentor accept). */
  pending: MentorRelationRow[];
}

export interface StudentMentorContextResponse {
  /** Mentor đang ACTIVE (null nếu chưa có). */
  mentor: MentorRelationRow | null;
  pending: MentorRelationRow[];
}

export interface ValidateMentorRequestInput {
  mentorRealmTier: number;
  studentRealmTier: number;
  studentPendingRequests: number;
  mentorActiveStudents: number;
  mentorAcceptingStudents: boolean;
  studentAlreadyHasActiveMentor: boolean;
}

/**
 * Pure validator cho 1 yêu cầu bái sư. Trả `null` nếu OK, hoặc 1
 * `MentorErrorCode` đầu tiên vi phạm. Test-friendly + reusable cho
 * cả admin tooling.
 */
export function validateMentorRequest(
  input: ValidateMentorRequestInput,
): MentorErrorCode | null {
  if (input.mentorRealmTier < MENTOR_LIMITS.MIN_MENTOR_REALM_TIER) {
    return 'TIER_TOO_LOW';
  }
  if (input.studentRealmTier > MENTOR_LIMITS.MAX_STUDENT_REALM_TIER) {
    return 'TIER_TOO_HIGH';
  }
  if (
    input.mentorRealmTier - input.studentRealmTier <
    MENTOR_LIMITS.MIN_TIER_GAP
  ) {
    return 'TIER_GAP_TOO_SMALL';
  }
  if (input.studentAlreadyHasActiveMentor) {
    return 'STUDENT_ALREADY_HAS_MENTOR';
  }
  if (!input.mentorAcceptingStudents) {
    return 'NOT_AUTHORIZED';
  }
  if (
    input.mentorActiveStudents >= MENTOR_LIMITS.MENTOR_STUDENT_MAX
  ) {
    return 'MENTOR_STUDENT_CAP_REACHED';
  }
  if (
    input.studentPendingRequests >=
    MENTOR_LIMITS.STUDENT_PENDING_REQUEST_MAX
  ) {
    return 'PENDING_REQUEST_CAP_REACHED';
  }
  return null;
}

export function sanitizeMentorIntro(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/[\u0000-\u001F\u007F]+/g, '').trim();
  if (!stripped) return null;
  return stripped.slice(0, MENTOR_LIMITS.MENTOR_INTRO_MAX);
}

export function sanitizeMentorRequestMessage(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/[\u0000-\u001F\u007F]+/g, '').trim();
  if (!stripped) return null;
  return stripped.slice(0, MENTOR_LIMITS.REQUEST_MESSAGE_MAX);
}
