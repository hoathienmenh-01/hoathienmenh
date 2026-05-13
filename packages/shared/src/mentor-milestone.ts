/**
 * Phase 35.2 — Mentor Milestone catalog (Sư Đồ Phase 2).
 *
 * Mở rộng Phase 31.0 Mentor foundation: thêm bảng milestone gate theo
 * realmOrder của *disciple*. Khi disciple đạt được realm tương ứng,
 * milestone flip LOCKED → AVAILABLE và CẢ HAI bên (mentor + disciple)
 * có thể claim reward riêng lẻ qua mail SYSTEM.
 *
 * Rules (catalog-level, server enforced):
 * - Linh thạch only — KHÔNG mint Tiên Ngọc (premium paid).
 * - Mentor reward < Disciple reward (mentor passive bonus, disciple
 *   là người làm thật).
 * - 8 milestone (realm order 2..9 — Trúc Cơ → Độ Kiếp). Span 6 realms.
 * - Cumulative cap: mentor ≤ 955_000 linh thạch / disciple; disciple
 *   ≤ 1_405_000 / mentor. Không quá lạm phát so với regular cultivation
 *   reward (60-90k linh thạch / day cap regular).
 * - Anti-clone: disciple phải đạt realm THẬT — không proxy farm.
 */

import { realmByKey } from './realms';

export const MENTOR_MILESTONE_ROLES = ['MENTOR', 'DISCIPLE'] as const;
export type MentorMilestoneRole = (typeof MENTOR_MILESTONE_ROLES)[number];

export const MENTOR_MILESTONE_STATUSES = [
  'LOCKED',
  'AVAILABLE',
  'CLAIMED',
] as const;
export type MentorMilestoneStatus = (typeof MENTOR_MILESTONE_STATUSES)[number];

export interface MentorMilestoneDef {
  /** Catalog key — stable string ID, soft-ref bởi `MentorMilestoneProgress.milestoneKey`. */
  milestoneKey: string;
  /** Realm key disciple phải đạt (cùng key với `realms.ts`). */
  requiredRealmKey: string;
  /** Realm order tương ứng (auto resolve từ catalog). Test guard: phải match. */
  requiredRealmOrder: number;
  /** Reward cho mentor — linh thạch only. */
  mentorRewardLinhThach: bigint;
  /** Reward cho disciple — linh thạch only. */
  discipleRewardLinhThach: bigint;
  /** UI label VI — short. */
  titleVi: string;
  /** UI label EN — short. */
  titleEn: string;
}

const RAW: ReadonlyArray<Omit<MentorMilestoneDef, 'requiredRealmOrder'>> = [
  {
    milestoneKey: 'mentor_milestone_truc_co',
    requiredRealmKey: 'truc_co',
    mentorRewardLinhThach: 5_000n,
    discipleRewardLinhThach: 8_000n,
    titleVi: 'Trúc Cơ',
    titleEn: 'Foundation Building',
  },
  {
    milestoneKey: 'mentor_milestone_kim_dan',
    requiredRealmKey: 'kim_dan',
    mentorRewardLinhThach: 10_000n,
    discipleRewardLinhThach: 15_000n,
    titleVi: 'Kim Đan',
    titleEn: 'Golden Core',
  },
  {
    milestoneKey: 'mentor_milestone_nguyen_anh',
    requiredRealmKey: 'nguyen_anh',
    mentorRewardLinhThach: 20_000n,
    discipleRewardLinhThach: 30_000n,
    titleVi: 'Nguyên Anh',
    titleEn: 'Nascent Soul',
  },
  {
    milestoneKey: 'mentor_milestone_hoa_than',
    requiredRealmKey: 'hoa_than',
    mentorRewardLinhThach: 40_000n,
    discipleRewardLinhThach: 60_000n,
    titleVi: 'Hoá Thần',
    titleEn: 'Soul Transformation',
  },
  {
    milestoneKey: 'mentor_milestone_luyen_hu',
    requiredRealmKey: 'luyen_hu',
    mentorRewardLinhThach: 80_000n,
    discipleRewardLinhThach: 120_000n,
    titleVi: 'Luyện Hư',
    titleEn: 'Void Refining',
  },
  {
    milestoneKey: 'mentor_milestone_hop_the',
    requiredRealmKey: 'hop_the',
    mentorRewardLinhThach: 150_000n,
    discipleRewardLinhThach: 220_000n,
    titleVi: 'Hợp Thể',
    titleEn: 'Body Integration',
  },
  {
    milestoneKey: 'mentor_milestone_dai_thua',
    requiredRealmKey: 'dai_thua',
    mentorRewardLinhThach: 250_000n,
    discipleRewardLinhThach: 350_000n,
    titleVi: 'Đại Thừa',
    titleEn: 'Great Vehicle',
  },
  {
    milestoneKey: 'mentor_milestone_do_kiep',
    requiredRealmKey: 'do_kiep',
    mentorRewardLinhThach: 400_000n,
    discipleRewardLinhThach: 600_000n,
    titleVi: 'Độ Kiếp',
    titleEn: 'Tribulation Crossing',
  },
];

export const MENTOR_MILESTONES: readonly MentorMilestoneDef[] = RAW.map((m) => {
  const realm = realmByKey(m.requiredRealmKey);
  if (!realm) {
    throw new Error(
      `mentor-milestone: requiredRealmKey "${m.requiredRealmKey}" not found in realms catalog`,
    );
  }
  return {
    ...m,
    requiredRealmOrder: realm.order,
  };
});

const BY_KEY: Map<string, MentorMilestoneDef> = new Map(
  MENTOR_MILESTONES.map((m) => [m.milestoneKey, m]),
);

export function mentorMilestoneByKey(
  key: string,
): MentorMilestoneDef | undefined {
  return BY_KEY.get(key);
}

export function isMentorMilestoneKey(v: unknown): v is string {
  return typeof v === 'string' && BY_KEY.has(v);
}

export function isMentorMilestoneRole(v: unknown): v is MentorMilestoneRole {
  return (
    typeof v === 'string' &&
    (MENTOR_MILESTONE_ROLES as readonly string[]).includes(v)
  );
}

export function isMentorMilestoneStatus(
  v: unknown,
): v is MentorMilestoneStatus {
  return (
    typeof v === 'string' &&
    (MENTOR_MILESTONE_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Get reward amount cho role tại 1 milestone.
 * Throw nếu key/role invalid — caller phải validate trước.
 */
export function getMentorMilestoneReward(
  milestoneKey: string,
  role: MentorMilestoneRole,
): bigint {
  const m = BY_KEY.get(milestoneKey);
  if (!m) throw new Error(`unknown milestoneKey: ${milestoneKey}`);
  return role === 'MENTOR'
    ? m.mentorRewardLinhThach
    : m.discipleRewardLinhThach;
}

/**
 * Resolve milestone "earned" set theo disciple realm order hiện tại.
 * Trả về milestoneKeys mà disciple đạt yêu cầu (AVAILABLE-or-CLAIMED candidate).
 */
export function mentorMilestonesEarnedAt(
  realmOrder: number,
): readonly string[] {
  return MENTOR_MILESTONES.filter((m) => realmOrder >= m.requiredRealmOrder).map(
    (m) => m.milestoneKey,
  );
}

export interface MentorMilestoneProgressRow {
  milestoneKey: string;
  status: MentorMilestoneStatus;
  reachedAt: string | null;
  /** Snapshot title cho UI fast-render. */
  titleVi: string;
  titleEn: string;
  /** Reward cho viewer (mentor hoặc disciple, tuỳ context). */
  viewerRewardLinhThach: string;
  /** Đã claim ở vai trò viewer chưa? */
  viewerClaimed: boolean;
}

export interface MentorMilestoneListResponse {
  /** Quan hệ ACTIVE viewer là MENTOR — null nếu user không phải mentor active. */
  asMentor: ReadonlyArray<{
    relationId: string;
    studentUserId: string;
    studentDisplayName: string | null;
    studentRealmKey: string;
    studentRealmOrder: number;
    progress: ReadonlyArray<MentorMilestoneProgressRow>;
  }>;
  /** Quan hệ ACTIVE viewer là DISCIPLE — null nếu user không phải student. */
  asDisciple: {
    relationId: string;
    mentorUserId: string;
    mentorDisplayName: string | null;
    selfRealmKey: string;
    selfRealmOrder: number;
    progress: ReadonlyArray<MentorMilestoneProgressRow>;
  } | null;
}
